from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DocumentVersionBase(BaseModel):
    content: str
    title: str


class DocumentCreate(BaseModel):
    title: str


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class DocumentVersionsRead(DocumentVersionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    document_id: int
    version: int
    created_at: datetime
    updated_at: datetime


class AIContextFile(BaseModel):
    name: str
    content: str


class AIChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    context_files: list[AIContextFile] = Field(default_factory=list)


class AIMessageRead(AIChatMessage):
    id: int
    document_version_id: int
    created_at: datetime


class AIWriteRequest(BaseModel):
    instruction: str
    title: str
    content: str
    history: list[AIChatMessage] = Field(default_factory=list)
    context_files: list[AIContextFile] = Field(default_factory=list)


class AIWriteResponse(BaseModel):
    reply: str
    content: str


class AIActionResponse(AIWriteResponse):
    action: Literal["answer", "edit"]


class AISavedWriteResponse(BaseModel):
    reply: str
    document: DocumentVersionsRead
    messages: list[AIMessageRead]
    did_edit: bool
