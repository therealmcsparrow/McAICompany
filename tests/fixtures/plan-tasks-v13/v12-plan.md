# Plan

## Tasks

### T1 first task
- role: backend-engineer
- files: a/one.js, a/one.test.js
- depends-on: none
- parallel: yes

### T2 second task
- role: frontend-engineer
- files: b/two.js
- depends-on: none
- parallel: yes

### T3 third task
- role: backend-engineer
- files: a/one.js
- depends-on: T1
- parallel: yes

### T4 fourth task
- role: qa
- files: c/four.js
- depends-on: T2
- parallel: no
