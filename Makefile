VERSION :=$(shell git describe --tags --always)
LDFLAGS := "-s -w -X main.version=$(VERSION)"
OUT_DIR := dist
CMD := ./cmd/rmfakecloud
BINARY := rmfakecloud
BUILD = CGO_ENABLED=1 go build -tags cairo -ldflags $(LDFLAGS) -o $(@) $(CMD)
ASSETS = ui/dist
GOFILES := $(shell find . -iname '*.go' ! -iname "*_test.go")
GOFILES += $(ASSETS)
UIFILES := $(shell find ui/src)
UIFILES += $(shell find ui/public)
UIFILES += ui/package.json
PNPM	= cd ui; pnpm

.PHONY: all run runui clean test testgo testui build

build: $(OUT_DIR)/$(BINARY)

all: build

$(OUT_DIR)/$(BINARY):$(GOFILES)
	$(BUILD)

run: $(ASSETS)
	go run -tags cairo $(CMD) $(ARG)

$(ASSETS): $(UIFILES) ui/pnpm-lock.yaml
	$(PNPM) build

ui/pnpm-lock.yaml: ui/node_modules ui/package.json
	$(PNPM) i
	@touch -mr $(shell ls -Atd $? | head -1) $@

ui/node_modules:
	mkdir -p $@

runui: ui/pnpm-lock.yaml
	$(PNPM) run dev

clean:
	rm -f $(OUT_DIR)/*
	rm -fr $(ASSETS)

test: testui testgo

testui:
	echo "TODO: fix this"

testgo:
	go test -tags cairo ./...

