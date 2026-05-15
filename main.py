from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from routers import dialog, log, timer
from services.log_service import get_last_rest_info, get_last_work_info, init_csv
from services.timer_service import (
    restore_break_state,
    restore_work_state,
    start_background_thread,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_csv()
    rest_info = get_last_rest_info()
    if rest_info:
        restore_break_state(*rest_info)
    else:
        work_info = get_last_work_info()
        if work_info:
            restore_work_state(*work_info)
    start_background_thread()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(timer.router)
app.include_router(dialog.router)
app.include_router(log.router)
# StaticFiles はルーター登録後にマウントする
app.mount("/", StaticFiles(directory="static", html=True), name="static")
