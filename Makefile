PYTHON ?= python3
VENV ?= .venv
VENV_BIN := $(VENV)/bin
PIP := $(VENV_BIN)/pip
PY := $(VENV_BIN)/python
NPM ?= npm
UI_DIR ?= ui
API_HOST ?= 0.0.0.0
API_PORT ?= 8000
UI_HOST ?= 0.0.0.0
UI_PORT ?= 5173
DB ?= out/traces.db
JSON ?= out/traces.json
INPUT ?=

.PHONY: help install install-python install-ui test test-python build build-python build-ui package run-api run-ui ingest clean

help:
	@echo "Targets:"
	@echo "  make install         # create venv + install Python and UI deps"
	@echo "  make test            # run Python tests"
	@echo "  make build           # build Python package + UI bundle"
	@echo "  make package         # build Python distribution artifacts"
	@echo "  make run-api         # run the local API server"
	@echo "  make run-ui          # run the Vite UI dev server"
	@echo "  make ingest INPUT=/path/to/sessions [DB=out/traces.db JSON=out/traces.json]"
	@echo "  make clean           # remove build artifacts"

install: install-python install-ui

install-python:
	bash "$(ROOT_DIR)/scripts/install.sh"

install-ui:
	cd $(UI_DIR) && $(NPM) ci

test: test-python

test-python:
	$(PY) -m unittest discover -s tests -v

build: build-python build-ui

build-python: package

package:
	$(PY) -m build

build-ui:
	cd $(UI_DIR) && $(NPM) run build

run-api:
	./scripts/run-api.sh --host $(API_HOST) --port $(API_PORT) --db $(DB)

run-ui:
	./scripts/run-ui.sh --host $(UI_HOST) --port $(UI_PORT)

ingest:
	@if [ -z "$(INPUT)" ]; then echo "Usage: make ingest INPUT=/path/to/sessions [DB=out/traces.db JSON=out/traces.json]"; exit 2; fi
	./scripts/ingest.sh --input "$(INPUT)" --db $(DB) --json $(JSON)

clean:
	rm -rf build dist *.egg-info $(UI_DIR)/dist
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	find . -type f -name '*.pyc' -delete
