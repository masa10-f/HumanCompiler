"""
Base service class with common CRUD operations
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Generic, List, Optional, TypeVar, Union
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlmodel import Session, SQLModel, select

from taskagent_api.common.error_handlers import (
    ResourceNotFoundError,
    ServiceError,
    safe_execute,
    validate_uuid,
)

T = TypeVar('T', bound=SQLModel)
CreateT = TypeVar('CreateT')
UpdateT = TypeVar('UpdateT')


class BaseService(ABC, Generic[T, CreateT, UpdateT]):
    """Base service class with common CRUD operations"""
    
    def __init__(self, model: type[T]):
        self.model = model
    
    @abstractmethod
    def _create_instance(self, data: CreateT, **kwargs) -> T:
        """Create a new model instance. Must be implemented by subclasses."""
        pass
    
    @abstractmethod
    def _get_user_filter(self, user_id: Union[str, UUID]):
        """Get the filter condition for user ownership. Must be implemented by subclasses."""
        pass
    
    def create(self, session: Session, data: CreateT, user_id: Union[str, UUID], **kwargs) -> T:
        """Create a new entity"""
        user_id = validate_uuid(user_id, "user_id")
        
        def create_operation():
            instance = self._create_instance(data, user_id=user_id, **kwargs)
            instance.id = uuid4()
            session.add(instance)
            session.flush()  # Get ID without committing
            return instance
        
        return safe_execute(session, create_operation)
    
    def get_by_id(self, session: Session, entity_id: Union[str, UUID], user_id: Union[str, UUID]) -> Optional[T]:
        """Get entity by ID for specific user"""
        entity_id = validate_uuid(entity_id, "entity_id")
        user_id = validate_uuid(user_id, "user_id")
        
        statement = select(self.model).where(
            self.model.id == entity_id,
            self._get_user_filter(user_id)
        )
        
        result = session.exec(statement).first()
        if not result:
            raise ResourceNotFoundError(self.model.__name__, entity_id)
        
        return result
    
    def get_all(
        self, 
        session: Session, 
        user_id: Union[str, UUID],
        skip: int = 0, 
        limit: int = 100,
        **filters
    ) -> List[T]:
        """Get all entities for specific user with optional filters"""
        statement = select(self.model).where(
            self._get_user_filter(user_id)
        )
        
        # Add additional filters
        for key, value in filters.items():
            if hasattr(self.model, key) and value is not None:
                statement = statement.where(getattr(self.model, key) == value)
        
        # Add consistent ordering for predictable results
        if hasattr(self.model, 'created_at'):
            statement = statement.order_by(self.model.created_at.desc())
        
        statement = statement.offset(skip).limit(limit)
        return list(session.exec(statement).all())
    
    def update(
        self, 
        session: Session, 
        entity_id: Union[str, UUID], 
        data: UpdateT, 
        user_id: Union[str, UUID]
    ) -> T:
        """Update entity"""
        entity_id = validate_uuid(entity_id, "entity_id")
        user_id = validate_uuid(user_id, "user_id")
        
        # This will raise ResourceNotFoundError if not found
        entity = self.get_by_id(session, entity_id, user_id)
        
        def update_operation():
            update_data = data.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                if hasattr(entity, field):
                    setattr(entity, field, value)
            
            if hasattr(entity, 'updated_at'):
                entity.updated_at = datetime.utcnow()
            
            session.add(entity)
            session.flush()
            return entity
        
        return safe_execute(session, update_operation)
    
    def delete(self, session: Session, entity_id: Union[str, UUID], user_id: Union[str, UUID]) -> bool:
        """Delete entity"""
        entity_id = validate_uuid(entity_id, "entity_id")
        user_id = validate_uuid(user_id, "user_id")
        
        # This will raise ResourceNotFoundError if not found
        entity = self.get_by_id(session, entity_id, user_id)
        
        def delete_operation():
            session.delete(entity)
            return True
        
        return safe_execute(session, delete_operation)