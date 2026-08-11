"""/api/graph — payload for the 3D sphere UI."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.knowledge import build_graph_payload


router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
def graph(db: Session = Depends(get_db)):
    return build_graph_payload(db)