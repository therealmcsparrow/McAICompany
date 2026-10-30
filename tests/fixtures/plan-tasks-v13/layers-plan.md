# Plan

## Tasks

### T1 models
- role: backend-engineer
- files: src/models.js
- depends-on: none
- parallel: yes
- context: 30k
- slice: all data models and tables -> schema migrations — demo: src/models.js
- seams: src/models.js#Model

### T2 routes
- role: backend-engineer
- files: src/routes.js
- depends-on: none
- parallel: yes
- context: 30k
- slice: all API routes and handlers → endpoints — demo: src/routes.js
- seams: src/routes.js#route
