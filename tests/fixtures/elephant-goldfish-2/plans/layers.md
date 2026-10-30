# Plan: saved rows, cut by layer

## Tasks

### T1 data models
- role: backend-engineer
- files: src/models.mjs
- depends-on: none
- parallel: yes
- context: 30k
- slice: all data models and tables → schema migrations — demo: src/models.mjs
- seams: src/models.mjs#Row

### T2 api routes
- role: backend-engineer
- files: src/routes.mjs
- depends-on: T1
- parallel: yes
- context: 30k
- slice: all api routes and handlers → endpoints — demo: src/routes.mjs
- seams: src/routes.mjs#route

### T3 ui components
- role: backend-engineer
- files: src/view.mjs
- depends-on: T2
- parallel: yes
- context: 30k
- slice: the ui and frontend views → components — demo: src/view.mjs
- seams: src/view.mjs#view
