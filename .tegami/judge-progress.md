---
packages:
  'prosebook': patch
---

### prosebook judge says the time left and the cost so far, in a terminal or not

The progress line counts requests, with the time left and the cost so far, rewritten in place in a terminal. Without a terminal, as an agent or CI reads the output, the line is printed at each tenth of the run, where the run used to print nothing until the end.
