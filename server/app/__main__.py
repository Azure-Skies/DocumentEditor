from contextlib import asynccontextmanager
from datetime import datetime
import json
import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from openai import OpenAI
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

import app.models as models
import app.schemas as schemas
from app.data import DOCUMENT_1, DOCUMENT_2
from app.db import Base, SessionLocal, engine, get_db

load_dotenv()

SEED_DOCUMENTS = [
    {"id": 1, "title": "Patent 1", "content": DOCUMENT_1},
    {"id": 2, "title": "Patent 2", "content": DOCUMENT_2},
]

AI_SYSTEM_PROMPT = (
    "You are a careful patent drafting assistant. Modify the provided "
    "HTML document only when the user asks you to edit, rewrite, draft, "
    "delete, add, update, or otherwise change the document. If the user "
    "asks a question, asks for an explanation, or asks for analysis, answer "
    "without changing the document. Preserve valid HTML and claim numbering "
    "unless the user explicitly asks to change structure. Use uploaded "
    "context files when relevant. Return JSON with keys 'action', 'reply', "
    "and 'content'. The 'action' must be either 'answer' or 'edit'. The "
    "'reply' is a concise response to the user. The 'content' is the complete "
    "HTML document; for answer-only requests it must be exactly the current "
    "HTML content unchanged."
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        db.execute(
            insert(models.Document),
            [
                {"id": document["id"], "title": document["title"]}
                for document in SEED_DOCUMENTS
            ],
        )
        db.add_all(
            [
                models.DocumentVersion(
                    document_id=document["id"],
                    content=document["content"],
                    version=1,
                )
                for document in SEED_DOCUMENTS
            ]
        )
        db.commit()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def serialize_document_version(
    db: Session, document_version: models.DocumentVersion
) -> schemas.DocumentVersionsRead:
    document = db.scalar(
        select(models.Document).where(models.Document.id == document_version.document_id)
    )
    return schemas.DocumentVersionsRead(
        id=document_version.id,
        document_id=document_version.document_id,
        content=document_version.content,
        title=document.title if document else "",
        version=document_version.version,
        created_at=document_version.created_at,
        updated_at=document_version.updated_at,
    )


def get_or_404(db: Session, document_id: int) -> models.Document:
    document = db.scalar(select(models.Document).where(models.Document.id == document_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    return document


def get_document_version_or_404(
    db: Session, document_id: int, version_id: int
) -> models.DocumentVersion:
    document_version = db.scalar(
        select(models.DocumentVersion).where(
            models.DocumentVersion.id == version_id,
            models.DocumentVersion.document_id == document_id,
        )
    )
    if document_version is None:
        raise HTTPException(status_code=404, detail="Document version not found")

    return document_version


def get_ai_messages(db: Session, version_id: int) -> list[schemas.AIMessageRead]:
    messages = []
    for message in db.scalars(
        select(models.AIMessage)
        .where(models.AIMessage.document_version_id == version_id)
        .order_by(models.AIMessage.created_at, models.AIMessage.id)
    ):
        try:
            context_files = [
                schemas.AIContextFile(**context_file)
                for context_file in json.loads(message.context_files or "[]")
            ]
        except (TypeError, json.JSONDecodeError):
            context_files = []

        messages.append(
            schemas.AIMessageRead(
                id=message.id,
                document_version_id=message.document_version_id,
                role=message.role,
                content=message.content,
                context_files=context_files,
                created_at=message.created_at,
            )
        )

    return messages


def generate_ai_response(request: schemas.AIWriteRequest) -> schemas.AIActionResponse:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")

    openai_client = OpenAI()
    history = "\n".join(
        f"{message.role}: {message.content}" for message in request.history[-8:]
    )
    context_files = "\n\n".join(
        f"File: {context_file.name}\n{context_file.content}"
        for context_file in request.context_files
    )
    user_prompt = (
        f"Title: {request.title}\n\n"
        f"Recent chat:\n{history or 'No prior chat.'}\n\n"
        f"Uploaded context files:\n{context_files or 'No uploaded files.'}\n\n"
        f"User instruction: {request.instruction}\n\n"
        f"Current HTML content:\n{request.content}"
    )
    try:
        response = openai_client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": AI_SYSTEM_PROMPT,
                },
                {"role": "user", "content": user_prompt},
            ],
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI request failed: {error}",
        ) from error

    output_text = response.choices[0].message.content or ""
    try:
        parsed_response = json.loads(output_text)
    except json.JSONDecodeError:
        return schemas.AIActionResponse(
            action="answer",
            reply=output_text,
            content=request.content,
        )

    action = parsed_response.get("action", "answer")
    if action not in {"answer", "edit"}:
        action = "answer"

    return schemas.AIActionResponse(
        action=action,
        reply=parsed_response.get("reply", "Draft updated."),
        content=parsed_response.get("content", request.content),
    )

@app.post("/ai/write")
def write_with_ai(request: schemas.AIWriteRequest) -> schemas.AIWriteResponse:
    """Generate a suggested document rewrite from a natural language request."""
    ai_response = generate_ai_response(request)
    return schemas.AIWriteResponse(
        reply=ai_response.reply,
        content=ai_response.content,
    )


@app.get("/documents")
def get_documents(db: Session = Depends(get_db)) -> list[schemas.DocumentRead]:
    """Get all documents."""
    return list(db.scalars(select(models.Document).order_by(models.Document.id)))


@app.post("/documents")
def create_document(
    document: schemas.DocumentCreate,
    db: Session = Depends(get_db),
) -> schemas.DocumentVersionsRead:
    """Create a document with an initial blank version."""
    title = document.title.strip() or "Untitled Patent"
    saved_document = models.Document(title=title)
    db.add(saved_document)
    db.flush()

    document_version = models.DocumentVersion(
        document_id=saved_document.id,
        content="<p></p>",
        version=1,
    )
    db.add(document_version)
    db.commit()
    db.refresh(document_version)
    return serialize_document_version(db, document_version)


@app.get("/document/{document_id}")
def get_document(
    document_id: int, db: Session = Depends(get_db)
) -> schemas.DocumentVersionsRead:
    """Get a document from the database"""
    document_version = db.scalar(
        select(models.DocumentVersion)
        .where(models.DocumentVersion.document_id == document_id)
        .order_by(models.DocumentVersion.version.desc())
        .limit(1)
    )
    if document_version is None:
        raise HTTPException(status_code=404, detail="Document version not found")

    return serialize_document_version(db, document_version)


@app.post("/document/{document_id}/version/{version_id}/ai/write")
def write_and_save_with_ai(
    document_id: int,
    version_id: int,
    request: schemas.AIWriteRequest,
    db: Session = Depends(get_db),
) -> schemas.AISavedWriteResponse:
    """Generate an AI rewrite and save it to the selected document version."""
    document_version = get_document_version_or_404(db, document_id, version_id)
    saved_document = get_or_404(db, document_id)
    ai_response = generate_ai_response(request)
    did_edit = ai_response.action == "edit"
    if did_edit:
        saved_document.title = request.title
        document_version.content = ai_response.content
        document_version.updated_at = datetime.now()
    db.add_all(
        [
            models.AIMessage(
                document_version_id=version_id,
                role="user",
                content=request.instruction,
                context_files=json.dumps(
                    [
                        context_file.model_dump()
                        for context_file in request.context_files
                    ]
                ),
            ),
            models.AIMessage(
                document_version_id=version_id,
                role="assistant",
                content=ai_response.reply,
            ),
        ]
    )
    db.commit()
    db.refresh(document_version)

    return schemas.AISavedWriteResponse(
        reply=ai_response.reply,
        document=serialize_document_version(db, document_version),
        messages=get_ai_messages(db, version_id),
        did_edit=did_edit,
    )


@app.get("/document/{document_id}/version/{version_id}/ai/messages")
def get_version_ai_messages(
    document_id: int,
    version_id: int,
    db: Session = Depends(get_db),
) -> list[schemas.AIMessageRead]:
    """Get persisted AI chat messages for a document version."""
    get_document_version_or_404(db, document_id, version_id)
    return get_ai_messages(db, version_id)


@app.get("/document/{document_id}/version/{version_id}")
def get_document_version(
    document_id: int,
    version_id: int,
    db: Session = Depends(get_db),
) -> schemas.DocumentVersionsRead:
    """Get a specific document version."""
    document_version = get_document_version_or_404(db, document_id, version_id)
    return serialize_document_version(db, document_version)


@app.get("/document/{document_id}/versions")
def get_document_versions(
    document_id: int,
    db: Session = Depends(get_db),
) -> list[schemas.DocumentVersionsRead]:
    """Get all versions for a document."""
    return [
        serialize_document_version(db, document_version)
        for document_version in db.scalars(
            select(models.DocumentVersion)
            .where(models.DocumentVersion.document_id == document_id)
            .order_by(models.DocumentVersion.version.desc())
        )
    ]


@app.post("/save/{document_id}")
def save(
    document_id: int,
    document: schemas.DocumentVersionBase,
    db: Session = Depends(get_db),
) -> schemas.DocumentVersionsRead:
    """Save the document to the database"""
    saved_document = get_or_404(db, document_id)
    saved_document.title = document.title
    latest_version = (
        db.scalar(
            select(models.DocumentVersion.version)
            .where(models.DocumentVersion.document_id == document_id)
            .order_by(models.DocumentVersion.version.desc())
            .limit(1)
        )
        or 0
    )

    document_version = models.DocumentVersion(
        document_id=document_id,
        content=document.content,
        version=latest_version + 1,
    )
    db.add(document_version)
    db.commit()
    db.refresh(document_version)
    return serialize_document_version(db, document_version)


@app.put("/document/{document_id}/version/{version_id}")
def update_version(
    document_id: int,
    version_id: int,
    document: schemas.DocumentVersionBase,
    db: Session = Depends(get_db),
) -> schemas.DocumentVersionsRead:
    """Update a specific document version."""
    document_version = get_document_version_or_404(db, document_id, version_id)
    saved_document = get_or_404(db, document_id)
    saved_document.title = document.title
    document_version.content = document.content
    document_version.updated_at = datetime.now()
    db.commit()
    db.refresh(document_version)
    return serialize_document_version(db, document_version)
