from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.models.response import BaseResponse, ListResponse, ResponseBase
from src.schemas.config_kv import ConfigKvCreate, ConfigKvRead, ConfigKvUpdate
from src.service.config_kv_service import ConfigKvService

router = APIRouter(tags=["配置管理"])


@router.post(
    "/config-kvs/create",
    response_model=ResponseBase[ConfigKvRead],
    status_code=status.HTTP_201_CREATED,
)
def create_config_kv(
    payload: ConfigKvCreate, db: Session = Depends(get_db)
) -> ResponseBase[ConfigKvRead]:
    row = ConfigKvService.create(
        db,
        config_key=payload.config_key,
        config_value=payload.config_value,
    )
    return ResponseBase(data=ConfigKvRead.model_validate(row))


@router.get("/config-kvs/list", response_model=ListResponse[ConfigKvRead])
def list_config_kvs(db: Session = Depends(get_db)) -> ListResponse[ConfigKvRead]:
    rows = ConfigKvService.list_all(db)
    return ListResponse(data=[ConfigKvRead.model_validate(row) for row in rows])


@router.get("/config-kvs/{config_key}", response_model=ResponseBase[ConfigKvRead])
def get_config_kv(
    config_key: str, db: Session = Depends(get_db)
) -> ResponseBase[ConfigKvRead]:
    row = ConfigKvService.get_by_key(db, config_key)
    return ResponseBase(data=ConfigKvRead.model_validate(row))


@router.put("/config-kvs/{config_key}", response_model=ResponseBase[ConfigKvRead])
def update_config_kv(
    config_key: str,
    payload: ConfigKvUpdate,
    db: Session = Depends(get_db),
) -> ResponseBase[ConfigKvRead]:
    row = ConfigKvService.upsert(
        db,
        config_key=config_key,
        config_value=payload.config_value,
    )
    return ResponseBase(data=ConfigKvRead.model_validate(row))


@router.delete(
    "/config-kvs/{config_key}",
    status_code=status.HTTP_200_OK,
    response_model=BaseResponse,
)
def delete_config_kv(config_key: str, db: Session = Depends(get_db)) -> BaseResponse:
    ConfigKvService.delete_by_key(db, config_key)
    return BaseResponse(data=None)
