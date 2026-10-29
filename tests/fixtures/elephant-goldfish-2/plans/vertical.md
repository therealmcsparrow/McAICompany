# Plan: saved rows

## Tasks

### T1 save one row
- role: backend-engineer
- files: src/save.mjs, src/save.test.mjs
- depends-on: none
- parallel: yes
- context: 40k
- slice: a user submits the form → the page shows the saved row — demo: src/save.test.mjs#shows the saved row
- seams: src/save.mjs#saveRow, src/save.mjs#renderRow

### T2 delete one row
- role: backend-engineer
- files: src/remove.mjs, src/remove.test.mjs
- depends-on: T1
- parallel: yes
- context: 35k
- slice: a user clicks delete on a row → the row is gone from the page — demo: src/remove.test.mjs#removes the row
- seams: src/remove.mjs#removeRow
