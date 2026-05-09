from fastapi import FastAPI

from routers import timer

app = FastAPI()
app.include_router(timer.router)
