from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from app.db import Base


class Document(Base):
    __tablename__ = "document"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)


class DocumentVersion(Base):
    __tablename__ = "document_version"
    __table_args__ = (
        UniqueConstraint("document_id", "version", name="uq_document_version_number"),
    )

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("document.id"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    version = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now)


class AIMessage(Base):
    __tablename__ = "ai_message"
    id = Column(Integer, primary_key=True, index=True)
    document_version_id = Column(
        Integer, ForeignKey("document_version.id"), nullable=False, index=True
    )
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    context_files = Column(Text, default="[]", nullable=False)
    created_at = Column(DateTime, default=datetime.now)
