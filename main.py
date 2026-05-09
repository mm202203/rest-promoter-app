from contextlib import asynccontextmanager

from fastapi import FastAPI

from routers import timer
from services.timer_service import start_background_thread


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_background_thread()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(timer.router)
