---
flowmap: 1
---

## Board index

- 0.0.1 Prototype ^n1
    - Combat System (done) ^n2
    - Enemy Mechanics ^n3
        - item drops, see [[Loot Tables]] (todo) ^n4
    - Level Design (todo) ^n5

%%
```flowmap-json
{
  "schema": 1,
  "theme": {},
  "nodes": [
    {"id":"n1","parent":null,"order":0,"text":"0.0.1 Prototype","x":0,"y":0},
    {"id":"n2","parent":"n1","order":0,"text":"Combat System","x":320,"y":-120,"status":"done"},
    {"id":"n3","parent":"n1","order":1,"text":"Enemy Mechanics","x":320,"y":0},
    {"id":"n5","parent":"n1","order":2,"text":"Level Design","x":320,"y":120,"status":"todo"},
    {"id":"n4","parent":"n3","order":0,"text":"item drops, see [[Loot Tables]]","x":640,"y":0,"status":"todo"}
  ],
  "links": [
    {"id":"l1","from":"n4","to":"n2","label":"depends on"}
  ]
}
```
%%
