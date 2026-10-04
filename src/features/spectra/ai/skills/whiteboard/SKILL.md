---
name: whiteboard
description: Diagrams, cycles, mind maps, flows and concept maps as nodes and connectors.
---

# Whiteboards

A whiteboard shows how ideas relate in space. Spectra computes positions from the layout you
choose; you decide what the nodes are, how they connect and which layout tells the story.

## Choose the spatial grammar

| Layout | Use it for |
| --- | --- |
| `flow-down` | A process or causal chain read top to bottom |
| `flow-right` | A timeline or pipeline read left to right |
| `cycle` | A loop that returns to its start: the water cycle, the cardiac cycle |
| `mind-map` | A central idea with branches |
| `grid` | Parallel items to compare or sort |

Never give coordinates. If the diagram looks wrong, change the layout or the structure.

## Nodes

- One idea per node, in a few words: "Water evaporates", not a paragraph.
- Give each node a short, stable `key` so connectors and later edits can refer to it.
- Types: `shape` for steps and concepts, `note` for an aside or example, `card` for a richer
  item, `text` for a free label.
- Colour encodes a real category (inputs and outputs, causes and effects), never decoration.
  Use `plain` when there is no category. Say what the colours mean in a `note` when it is not
  obvious.

## Connectors

- Every connector has a direction that means something: causes, becomes, leads to.
- Label a connector when the relationship is not obvious ("releases", "inhibits").
- Avoid connecting everything to everything; a reader should be able to trace each path.

## Size

Eight to twenty nodes is a readable diagram. Beyond that, split it into two diagrams or group
detail into fewer nodes.

## Example of excellent output

Request: "Diagram of the carbon cycle."

```json
{
  "layout": "cycle",
  "nodes": [
    { "key": "air", "text": "CO₂ in the atmosphere", "color": "cyan" },
    { "key": "plants", "text": "Plants and algae", "color": "mint" },
    { "key": "animals", "text": "Animals", "color": "gold" },
    { "key": "decomposers", "text": "Decomposers", "color": "orange" },
    { "key": "fossil", "text": "Fossil fuels", "color": "violet" }
  ],
  "edges": [
    { "from": "air", "to": "plants", "label": "photosynthesis" },
    { "from": "plants", "to": "animals", "label": "eaten" },
    { "from": "animals", "to": "air", "label": "respiration" },
    { "from": "plants", "to": "decomposers", "label": "die" },
    { "from": "animals", "to": "decomposers", "label": "die and excrete" },
    { "from": "decomposers", "to": "air", "label": "respiration" },
    { "from": "decomposers", "to": "fossil", "label": "buried over millions of years" },
    { "from": "fossil", "to": "air", "label": "combustion" }
  ]
}
```

Why it works: each node is one stage, every arrow names a process, and the cycle layout shows
that carbon returns to the air.

## Check before finishing

- Every node is connected or deliberately stands alone.
- Labels are short enough to read at the default zoom.
- The readback lists no overlaps or orphaned connectors.
