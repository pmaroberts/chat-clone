import os
import time
import sys
import sqlalchemy as sa

def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        sys.exit(2)

    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            sa.create_engine(url).connect().close()
            print("Database is ready")
            return 0
        except Exception as e:
            print(f"DB not ready: {e}")
            time.sleep(1)
    print("Timed out waiting for the database", file=sys.stderr)
    return 1

if __name__ == "__main__":
    sys.exit(main())
    