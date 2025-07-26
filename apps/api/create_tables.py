#!/usr/bin/env python3
"""
Create database tables using SQLModel.
"""

import logging
from sqlmodel import SQLModel
from database import db
from models import (
    User, Project, Goal, Task, Schedule, Log, 
    TaskStatus
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_tables():
    """Create all database tables"""
    try:
        logger.info("Creating database tables...")
        engine = db.get_engine()
        
        # Create all tables
        SQLModel.metadata.create_all(engine)
        
        logger.info("✅ All tables created successfully!")
        
        # List created tables
        with engine.connect() as conn:
            result = conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public';")
            tables = [row[0] for row in result]
            logger.info(f"Created tables: {tables}")
            
    except Exception as e:
        logger.error(f"❌ Failed to create tables: {e}")
        raise

if __name__ == "__main__":
    create_tables()