#!/usr/bin/env python3
"""
Database migration CLI for TaskAgent

Usage:
    python migrate.py apply      # Apply all pending migrations
    python migrate.py status     # Show migration status
    python migrate.py rollback --version=<version>  # Rollback specific migration
"""

import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent / "src"))

from humancompiler_api.migration_manager import MigrationManager
import argparse
import logging


def main():
    parser = argparse.ArgumentParser(
        description="TaskAgent Database Migration Manager",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python migrate.py apply                    # Apply all pending migrations
  python migrate.py status                   # Show migration status
  python migrate.py rollback --version=003   # Rollback migration 003
        """,
    )

    parser.add_argument(
        "command", choices=["apply", "status", "rollback"], help="Command to execute"
    )
    parser.add_argument("--version", help="Migration version (required for rollback)")
    parser.add_argument(
        "--dir", default="migrations", help="Migrations directory (default: migrations)"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Enable verbose logging"
    )

    args = parser.parse_args()

    # Setup logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    # Initialize migration manager
    manager = MigrationManager(args.dir)

    try:
        if args.command == "apply":
            print("🚀 Applying pending migrations...")
            applied, failed = manager.apply_all_pending()

            if failed > 0:
                print(f"\n❌ Migration failed! Applied: {applied}, Failed: {failed}")
                sys.exit(1)
            else:
                print(f"\n✅ Success! Applied {applied} migration(s)")

        elif args.command == "status":
            status_list = manager.get_migration_status()

            print("\n📊 Migration Status")
            print("=" * 80)
            print(
                f"{'Version':<30} {'Status':<12} {'Executed At':<20} {'Time':<10} Description"
            )
            print("-" * 80)

            for item in status_list:
                status_icon = "✅" if item["status"] == "applied" else "⏳"
                version = item["version"]
                status = item["status"]

                if item["executed_at"]:
                    executed = item["executed_at"].strftime("%Y-%m-%d %H:%M:%S")
                    time_ms = f"{item['execution_time_ms']}ms"
                else:
                    executed = "-"
                    time_ms = "-"

                description = (
                    item["description"][:40] + "..."
                    if len(item["description"]) > 40
                    else item["description"]
                )

                print(
                    f"{status_icon} {version:<28} {status:<12} {executed:<20} {time_ms:<10} {description}"
                )

            # Summary
            applied_count = sum(
                1 for item in status_list if item["status"] == "applied"
            )
            pending_count = sum(
                1 for item in status_list if item["status"] == "pending"
            )
            print("-" * 80)
            print(
                f"Total: {len(status_list)} | Applied: {applied_count} | Pending: {pending_count}"
            )

        elif args.command == "rollback":
            if not args.version:
                print("❌ Error: --version is required for rollback command")
                parser.print_help()
                sys.exit(1)

            print(f"⏪ Rolling back migration: {args.version}")
            success = manager.rollback_migration(args.version)

            if success:
                print(f"✅ Successfully rolled back migration: {args.version}")
            else:
                print(f"❌ Failed to rollback migration: {args.version}")
                sys.exit(1)

    except KeyboardInterrupt:
        print("\n⚠️  Operation cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        if args.verbose:
            import traceback

            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
