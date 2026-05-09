from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from routers import dialog, log, timer
from services.log_service import init_csv
from services.timer_service import start_background_thread


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_csv()
    start_background_thread()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(timer.router)
app.include_router(dialog.router)
app.include_router(log.router)
# StaticFiles はルーター登録後にマウントする
app.mount("/", StaticFiles(directory="static", html=True), name="static")
