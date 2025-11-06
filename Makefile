.PHONY: dev start stop clean


# Clean rebuild and start all containers
dev: clean
	docker compose build --no-cache
	$(MAKE) start

# Start all containers in the background
start:
	docker compose up -d

# Stop running containers (without removing)
stop:
	docker compose stop

# Stop and remove containers, networks, and volumes
clean:
	docker compose down -v


