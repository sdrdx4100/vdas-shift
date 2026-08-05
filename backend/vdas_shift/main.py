from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import database
from .api import router


def create_app() -> FastAPI:
    app = FastAPI(
        title="VDAS Shift API",
        description="車両計測データから実車ベースのシフト境界を推定するローカルAPI",
        version="0.1.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:8710", "http://localhost:8710"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.on_event("startup")
    def startup() -> None:
        database.init()

    return app


app = create_app()
