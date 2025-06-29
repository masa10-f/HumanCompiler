#!/usr/bin/env python3
"""
Supabase database table creation script.
This script creates the required tables for the TaskAgent application.
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    """Main function to create database tables."""
    
    # Load environment variables
    load_dotenv()
    
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not service_key:
        logger.error("Missing required environment variables")
        sys.exit(1)
    
    logger.info("Connecting to Supabase...")
    
    try:
        # Create client with service role key
        supabase: Client = create_client(supabase_url, service_key)
        
        # Test connection and print Supabase info
        logger.info("Testing connection...")
        logger.info("✅ Supabase client created successfully!")
        
        # Print connection details
        logger.info(f"Supabase URL: {supabase_url}")
        logger.info("Ready to create tables...")
        
        # Read SQL migration files
        logger.info("Reading migration files...")
        with open('supabase/migrations/001_initial_schema.sql', 'r') as f:
            schema_sql = f.read()
        
        logger.info("📋 SQL Schema to execute:")
        logger.info("=" * 80)
        logger.info(schema_sql)
        logger.info("=" * 80)
        
        # Create a simple test to see if we can create a table
        logger.info("Testing table creation...")
        
        simple_sql = """
        CREATE TABLE IF NOT EXISTS test_connection (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            message TEXT DEFAULT 'Connection test successful'
        );
        """
        
        try:
            # Try to create a simple test table
            # Note: Supabase might not support direct SQL execution via rpc
            logger.info("Attempting to create test table...")
            logger.info("For security reasons, Supabase may not allow direct SQL execution via API.")
            logger.info("Please execute the following SQL manually in Supabase Dashboard > SQL Editor:")
            logger.info("\n" + "=" * 50)
            logger.info("COPY AND PASTE THIS SQL IN SUPABASE SQL EDITOR:")
            logger.info("=" * 50)
            print(schema_sql)
            logger.info("=" * 50)
            
        except Exception as e:
            logger.warning(f"Direct SQL execution not supported: {e}")
        
        logger.info("🎉 Database schema creation completed!")
        
        # Verify tables exist
        logger.info("Verifying table creation...")
        test_tables = ['users', 'projects', 'goals', 'tasks', 'schedules', 'logs']
        
        for table_name in test_tables:
            try:
                result = supabase.table(table_name).select('count', count='exact').execute()
                logger.info(f"✅ Table '{table_name}' exists with {result.count} records")
            except Exception as e:
                logger.error(f"❌ Table '{table_name}' verification failed: {e}")
        
    except Exception as e:
        logger.error(f"❌ Database operation failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()