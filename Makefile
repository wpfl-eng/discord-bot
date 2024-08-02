.PHONY: install 

BRANCH=$(shell git rev-parse --abbrev-ref HEAD)

install: 
	npm install

