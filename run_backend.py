from __future__ import annotations

import uvicorn


if __name__ == "__main__":
    uvicorn.run("backend.vdas_shift.main:app", host="127.0.0.1", port=8711, reload=False)
