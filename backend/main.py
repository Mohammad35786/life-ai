from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers.adjust_plan import router as adjust_plan_router
from backend.routers.goal_parser import router as goal_parser_router
from backend.routers.goals import router as goals_router
from backend.routers.plans import router as plans_router
from backend.routers.tasks import router as tasks_router
from backend.routers.system import router as system_router
from backend.routers.debug import router as debug_router
from backend.routers.chat import router as chat_router
from backend.routers.roadmaps import router as roadmaps_router
from backend.routers.conversations import router as conversations_router

app = FastAPI(title="Life Agent API", separate_input_output_schemas=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(goal_parser_router)
app.include_router(goals_router)
app.include_router(plans_router)
app.include_router(tasks_router)
app.include_router(adjust_plan_router)
app.include_router(system_router)
app.include_router(debug_router)
app.include_router(chat_router)
app.include_router(roadmaps_router)
app.include_router(conversations_router)
