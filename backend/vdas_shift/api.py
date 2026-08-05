from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import analysis, ingest


router = APIRouter(prefix="/api")


def _wrap(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except ingest.IngestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@router.get("/datasets")
def datasets():
    return ingest.list_datasets()


@router.post("/datasets/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    tags: str | None = Form(None),
    dbc: UploadFile | None = File(None),
):
    try:
        tag_list = json.loads(tags) if tags else []
        if not isinstance(tag_list, list):
            raise ValueError
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="tags はJSON配列で指定してください") from exc
    return _wrap(
        ingest.ingest_file,
        file.file,
        file.filename or "upload.mf4",
        name,
        tag_list,
        dbc.file if dbc else None,
        dbc.filename if dbc else None,
    )


@router.get("/datasets/{dataset_id}/schema")
def schema(dataset_id: str):
    return _wrap(ingest.dataset_schema, dataset_id)


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str):
    _wrap(ingest.delete_dataset, dataset_id)
    return {"ok": True}


class TagsRequest(BaseModel):
    tags: list[str]


@router.put("/datasets/{dataset_id}/tags")
def tags(dataset_id: str, request: TagsRequest):
    return _wrap(ingest.update_tags, dataset_id, request.tags)


@router.get("/tags")
def all_tags():
    return ingest.all_tags()


class AnalyzeRequest(BaseModel):
    mapping: dict[str, str] = Field(default_factory=dict)
    bins: int = Field(default=10, ge=3, le=30)


@router.post("/datasets/{dataset_id}/shift-map")
def shift_map(dataset_id: str, request: AnalyzeRequest):
    return _wrap(analysis.analyze_dataset, dataset_id, request.mapping, request.bins)


@router.post("/datasets/{dataset_id}/mapping")
def save_mapping(dataset_id: str, request: AnalyzeRequest) -> dict[str, Any]:
    ingest.get_dataset(dataset_id)
    from . import database as db

    db.meta_execute(
        """INSERT INTO signal_mappings(dataset_id, mapping, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(dataset_id) DO UPDATE SET mapping=excluded.mapping, updated_at=datetime('now')""",
        (dataset_id, json.dumps(request.mapping, ensure_ascii=False)),
    )
    return {"ok": True, "mapping": request.mapping}
