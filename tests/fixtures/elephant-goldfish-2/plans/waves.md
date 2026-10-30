# Plan: three independent tasks

## Tasks

### T2 second in plan order, first by name
- role: backend-engineer
- files: src/b.txt
- depends-on: none
- parallel: yes
- context: 20k
- slice: a user clicks save → the toast shows saved — demo: src/b.txt
- seams: src/b.txt

### T1 first by name, second in plan order
- role: backend-engineer
- files: src/a.txt
- depends-on: none
- parallel: yes
- context: 20k
- slice: a user submits the form → the page shows the saved row — demo: src/a.txt
- seams: src/a.txt

### T3 later wave
- role: backend-engineer
- files: src/c.txt
- depends-on: T1
- parallel: yes
- context: 20k
- slice: a user opens the list → the list shows every row — demo: src/c.txt
- seams: src/c.txt
