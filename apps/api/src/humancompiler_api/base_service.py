"""
Base service class with common CRUD operations
"""

from abc import ABC, abstractmethod
from datetime import datetime, UTC
from typing import Generic, TypeVar
from uuid import UUID, uuid4

from sqlmodel import Session, SQLModel, select

from humancompiler_api.common.error_handlers import (
    ResourceNotFoundError,
    safe_execute,
    validate_uuid,
)
from humancompiler_api.models import ALLOWED_SORT_FIELDS, STATUS_PRIORITY

T = TypeVar("T", bound=SQLModel)
CreateT = TypeVar("CreateT")
UpdateT = TypeVar("UpdateT")


class BaseService(ABC, Generic[T, CreateT, UpdateT]):
    """Base service class with common CRUD operations"""

    def __init__(self, model: type[T]):
        self.model = model

    @abstractmethod
    def _create_instance(self, data: CreateT, **kwargs) -> T:
        """Create a new model instance. Must be implemented by subclasses."""
        pass

    @abstractmethod
    def _get_user_filter(self, user_id: str | UUID):
        """Get the filter condition for user ownership. Must be implemented by subclasses."""
        pass

    def create(
        self, session: Session, data: CreateT, user_id: str | UUID, **kwargs
    ) -> T:
        """Create a new entity"""
        user_id_validated = validate_uuid(user_id, "user_id")

        def create_operation():
            instance = self._create_instance(data, user_id=user_id_validated, **kwargs)
            instance.id = uuid4()
            session.add(instance)
            session.flush()  # Get ID without committing
            return instance

        return safe_execute(session, create_operation)

    def get_by_id(
        self, session: Session, entity_id: str | UUID, user_id: str | UUID
    ) -> T | None:
        """Get entity by ID for specific user"""
        entity_id = validate_uuid(entity_id, "entity_id")
        user_id_validated = validate_uuid(user_id, "user_id")

        statement = select(self.model).where(
            self.model.id == entity_id, self._get_user_filter(user_id_validated)
        )

        result = session.exec(statement).first()
        if not result:
            raise ResourceNotFoundError(self.model.__name__, entity_id)

        return result

    def get_all(
        self,
        session: Session,
        user_id: str | UUID,
        skip: int = 0,
        limit: int = 100,
        sort_by: str | None = None,
        sort_order: str | None = None,
        **filters,
    ) -> list[T]:
        """Get all entities for specific user with optional filters and sorting"""
        user_id_validated = validate_uuid(user_id, "user_id")
        statement = select(self.model).where(self._get_user_filter(user_id_validated))

        # Add additional filters
        for key, value in filters.items():
            if hasattr(self.model, key) and value is not None:
                statement = statement.where(getattr(self.model, key) == value)

        # Add sorting logic with enhanced validation
        if sort_by:
            # Validate sort field is allowed for this model
            model_name = self.model.__name__
            allowed_fields = ALLOWED_SORT_FIELDS.get(model_name, set())

            if sort_by not in allowed_fields:
                raise ValueError(
                    f"Invalid sort field '{sort_by}' for {model_name}. Allowed fields: {allowed_fields}"
                )

            # Check if field exists on model
            if not hasattr(self.model, sort_by):
                raise ValueError(f"Field '{sort_by}' not found on {model_name} model")

            sort_column = getattr(self.model, sort_by)

            # Handle status sorting with priority order
            if sort_by == "status":
                status_order = self._get_status_order()
                if status_order:
                    # Use CASE statement for status priority ordering
                    from sqlalchemy import case

                    order_expr = case(status_order, value=sort_column)
                else:
                    order_expr = sort_column
            else:
                order_expr = sort_column

            # Apply sort order
            if sort_order and sort_order.lower() == "desc":
                statement = statement.order_by(order_expr.desc())
            else:
                statement = statement.order_by(order_expr.asc())
        else:
            # Default ordering for predictable results
            if hasattr(self.model, "created_at"):
                statement = statement.order_by(self.model.created_at.desc())

        statement = statement.offset(skip).limit(limit)
        return list(session.exec(statement).all())

    def _get_status_order(self) -> dict | None:
        """Get status priority order for sorting. Override in subclasses if needed."""
        model_name = self.model.__name__.lower()
        return STATUS_PRIORITY.get(model_name, STATUS_PRIORITY["default"])

    def update(
        self,
        session: Session,
        entity_id: str | UUID,
        data: UpdateT,
        user_id: str | UUID,
    ) -> T:
        """Update entity"""
        entity_id = validate_uuid(entity_id, "entity_id")
        user_id_validated = validate_uuid(user_id, "user_id")

        # This will raise ResourceNotFoundError if not found
        entity = self.get_by_id(session, entity_id, user_id_validated)

        def update_operation():
            update_data = data.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                if hasattr(entity, field):
                    setattr(entity, field, value)

            if hasattr(entity, "updated_at"):
                entity.updated_at = datetime.now(UTC)

            session.add(entity)
            session.flush()
            return entity

        return safe_execute(session, update_operation)

    def delete(
        self, session: Session, entity_id: str | UUID, user_id: str | UUID
    ) -> bool:
        """Delete entity"""
        entity_id = validate_uuid(entity_id, "entity_id")
        user_id_validated = validate_uuid(user_id, "user_id")

        # This will raise ResourceNotFoundError if not found
        entity = self.get_by_id(session, entity_id, user_id_validated)

        def delete_operation():
            session.delete(entity)
            return True

        return safe_execute(session, delete_operation)
