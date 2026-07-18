# Gallery Taxonomy and Editorial Hierarchy

Status: editorial architecture proposal
Last reviewed: 2026-07-18

## Purpose

VictoPress organizes photographs through three complementary questions:

1. **Who is present?** — humans and their relationships.
2. **What kind of space is shown?** — natural, built, or in transit.
3. **Where did it happen?** — a normalized geographic hierarchy.

The central metaphor is a change of social scale:

```text
atom       -> one individual or element
molecule   -> a relationship, scene, or place
group      -> a collective, territory, or system
```

This document defines the conceptual hierarchy, candidate subtopics, and the
rules for deciding when a concept should be a folder, a gallery, or a tag. It
does not rename existing folders or change public URLs by itself.

## Sources reviewed

The proposal is based on both the VictoPress repository and the published
photographic archive.

### Current VictoPress hierarchy

The repository currently has three top-level editorial containers:

```text
Humans
├── Portraits
├── Social
└── Rituals

Spaces
├── Landscapes
├── Urban
└── Travelling

Geographies
├── America
│   └── USA
│       ├── Boston
│       ├── New York
│       └── San Francisco
├── Asia
│   ├── China
│   ├── Dubai
│   └── Japan
├── Australia
└── Europe
    ├── Spain
    │   ├── Canary Islands
    │   ├── Madrid
    │   ├── North of Spain
    │   └── South of Spain
    │       └── Granada
    └── United Kingdom
```

The top-level metadata lives in:

- [`content/galleries/humans/gallery.yaml`](../content/galleries/humans/gallery.yaml)
- [`content/galleries/spaces/gallery.yaml`](../content/galleries/spaces/gallery.yaml)
- [`content/galleries/geographies/gallery.yaml`](../content/galleries/geographies/gallery.yaml)

### Published reference hierarchy

The navigation published at [victoriano.me](https://victoriano.me/) currently
uses a different structure:

```text
Humans
├── Portraits
├── Social
└── Rituals

Spaces
├── Landscapes
├── Urban
└── Travelling

Europe
├── Granada
├── Madrid
├── London
├── Rome
├── Central Europe
├── South of Spain
├── North of Spain
└── Canary Islands

America
├── New York
└── San Francisco

Asia
├── Japan
├── China
├── Dubai
└── Australia
```

The published archive is useful as editorial evidence because it contains a
larger body of work. Its geography navigation should not be copied literally:
it places cities, regions, countries, and a continent at the same level.

## Findings

### Humans almost expresses the social scale already

The existing sequence is close to the intended model:

```text
Portraits -> Social -> Rituals
individual   relations   collective behavior
```

However, the three names do not describe the same kind of thing:

- `Portraits` describes a photographic treatment of an individual.
- `Social` is broad enough to include relationships, families, groups, and
  crowds.
- `Rituals` describes a kind of collective behavior, not a social scale.

The published [`Social`](https://victoriano.me/social) archive already contains
an implicit vocabulary: parents, grandparents, couples, friendship,
brotherhood, love across life stages, connection, and homophily. The published
[`Rituals`](https://victoriano.me/rituals) archive includes religious roles,
popular festivals, weddings, civic celebrations, and collective spectacles.

### Spaces mixes environment and movement

`Landscapes` and `Urban` classify the kind of environment. `Travelling`
classifies movement between environments. This is not necessarily a problem:
travelling is the useful connective layer between places. Its internal
vocabulary should describe carriers, nodes, routes, and transitions.

### Geography is a separate dimension

`Humans` and `Spaces` answer **what the photograph is about**. `Geographies`
answers **where it happened**. A photograph can therefore belong conceptually
to more than one branch, for example:

```text
Japan + Relations + Homophily
Madrid + Collectives + Civic ritual
Australia + Spaces + In transit
```

The filesystem should not need duplicate image files to represent these
cross-cutting classifications.

## Recommended conceptual hierarchy

### Humans

Use a consistent progression from individual to relationship to collective:

```text
Humans
├── Individuals        # atoms
│   └── Portraits
├── Relations          # molecules
│   └── Social
└── Collectives        # groups
    └── Rituals
```

The strongest long-term public labels would be `Individuals`, `Relations`, and
`Collectives`. A migration-safe first step can keep the current URLs and use
these concepts as tags or section labels.

#### Portraits / Individuals

Candidate subtopics:

- Identity and character
- Life stages and ageing
- Roles, trades, and professions
- Body and appearance
- Solitude
- Gaze and encounter
- Self-image and self-representation
- Environmental portraiture

#### Social / Relations

Candidate subtopics:

- Kinship
- Parenthood and children
- Grandparents and intergenerational relationships
- Couples and love
- Friendship
- Brotherhood and sisterhood
- Care and dependency
- Cooperation, work, and exchange
- Conflict and rivalry
- Distance, absence, and disconnection
- Mediated or technological connection
- Homophily and belonging

#### Collectives

Candidate subtopics:

- Families
- Peer groups
- Communities
- Crowds
- Subcultures and tribes
- Homophily and collective identity
- Institutions
- Classes, status, and hierarchy
- Collective action

#### Rituals

`Rituals` should be treated as an important subtopic of `Collectives`, with
further themes such as:

- Faith and religion
- Popular celebrations and festivals
- Weddings and rites of passage
- Civic and political ritual
- Protest and demonstration
- Sport and spectacle
- Tradition and inherited roles
- Work and institutional ceremony
- Mourning and remembrance

### Spaces

The current names can remain, while their subtopics follow the same movement
from element to place to system:

```text
Spaces
├── Landscapes         # natural environments
├── Urban              # built environments
└── Travelling         # flows between environments
```

A possible future relabeling is `Natural`, `Built`, and `In Transit`, but it is
not required for the taxonomy to work.

#### Landscapes

Candidate subtopics:

- Elements: trees, water, sky, rock, and snow
- Formations: fields, forests, coasts, mountains, and deserts
- Weather and atmosphere
- Seasons and time
- Cultivated landscape
- Wild territory
- Human traces and paths
- Horizon, isolation, and scale

#### Urban

Candidate subtopics:

- Fragments and architectural details
- Facades and buildings
- Streets
- Squares and public space
- Monuments and symbols
- Housing and domestic exteriors
- Infrastructure and mobility
- Industry and production
- Peripheries and urban edges
- Density, skyline, and overview
- Voids, absence, and abandoned space

#### Travelling

Candidate subtopics:

- Vehicles
- Roads, railways, and flight paths
- Stations, airports, and terminals
- Waiting
- Departures and arrivals
- Transit and transfers
- Windows and views in motion
- Luggage and travel objects
- Workers who make travel possible
- Thresholds and temporary spaces

The scale analogy for spaces is:

```text
atom       -> detail, object, vehicle, or natural element
molecule   -> scene, building, street, station, or landscape formation
group      -> territory, city, infrastructure, or transport network
```

### Geographies

Geographic data should use one normalized scale:

```text
Geographies
└── Continent
    └── Country
        └── Region
            └── City or locality
                └── Site or landmark
```

Example:

```text
Geographies
└── Europe
    └── Spain
        ├── Madrid
        ├── Canary Islands
        ├── North of Spain
        └── South of Spain
            └── Granada
```

Rules:

- Do not place a city, a country, and a continent as siblings in a strict
  geographic tree.
- Store the canonical hierarchy even if the public navigation hides empty or
  intermediate levels.
- A geographic gallery may expose the same cross-cutting views everywhere:
  `Individuals`, `Relations`, `Collectives`, `Rituals`, `Landscapes`, `Urban`,
  and `Travelling`.
- Geography describes location, not the editorial meaning of a photograph.

## Folders, galleries, and tags

The filesystem should represent the photograph's **primary editorial home**.
Tags should represent additional dimensions.

### Use a folder or gallery when

- The photographs form a recognizable editorial sequence.
- The sequence has its own question or thesis, not merely a shared attribute.
- It has enough strong photographs to sustain a page; around eight is a useful
  threshold, but coherence matters more than the exact count.
- It deserves a title, cover, description, and deliberate ordering.
- The category is likely to remain useful as the archive grows.

### Use a tag when

- A photograph belongs to several conceptual or geographic dimensions.
- The label is useful for filtering but too narrow for a standalone sequence.
- The concept cuts across multiple galleries, such as `friendship`,
  `homophily`, `waiting`, or `infrastructure`.
- Creating a folder would duplicate an image or make navigation too deep.

VictoPress already supports photo tags in `photos.yaml`, builds a tag index,
and exposes tag-based APIs. A temporary prefixed vocabulary can keep the tags
consistent until structured facets exist:

```yaml
- filename: "example.jpg"
  title: "Friends in Kyoto"
  tags:
    - humans
    - scale-relations
    - relation-friendship
    - relation-homophily
    - place-japan
    - place-kyoto
```

Suggested tag families:

| Family       | Examples                                                          |
| ------------ | ----------------------------------------------------------------- |
| Social scale | `scale-individuals`, `scale-relations`, `scale-collectives`       |
| Relationship | `relation-kinship`, `relation-love`, `relation-friendship`        |
| Collective   | `collective-family`, `collective-crowd`, `collective-institution` |
| Ritual       | `ritual-faith`, `ritual-festival`, `ritual-civic`                 |
| Space        | `space-landscape`, `space-urban`, `space-in-transit`              |
| Geography    | `place-spain`, `place-madrid`, `place-japan`                      |

These prefixes are a convention, not a change to the current data model.

## VictoPress behavior that supports the model

- Nested folders are scanned recursively by
  [`gallery-scanner.ts`](../app/lib/content-engine/gallery-scanner.ts).
- Parent galleries include photos from descendant galleries by default in
  [`gallery.$.tsx`](../app/routes/gallery.$.tsx).
- Gallery and photo metadata support tags in
  [`types.ts`](../app/lib/content-engine/types.ts).
- [`api.tags.ts`](../app/routes/api.tags.ts) builds the public tag index.

This means the archive can have deep canonical organization while parent pages
continue to present unified photographic selections.

## Recommended migration order

1. **Define tags first.** Classify the existing archive without moving files or
   changing URLs.
2. **Separate relations from collectives.** Keep `Portraits`; narrow `Social`
   toward relationships; identify material that belongs to `Collectives`.
3. **Move Rituals conceptually under Collectives.** A physical folder move can
   wait until redirects and URL compatibility are planned.
4. **Normalize geographic metadata.** Resolve continent, country, region, city,
   and site consistently before changing the visible navigation.
5. **Promote mature tags into galleries.** Only promote topics that have become
   coherent editorial bodies of work.
6. **Add virtual cross-views.** Allow a single photograph to appear in thematic
   and geographic views without copying its source file.

## Decision summary

The durable model separates three dimensions:

```text
WHO / SOCIAL SCALE
Individuals -> Relations -> Collectives

WHERE / SPATIAL SCALE
Element -> Place -> System

LOCATION / GEOGRAPHIC SCALE
Site -> City -> Region -> Country -> Continent
```

Folders hold primary editorial narratives. Tags connect those narratives
across social scale, space, movement, and geography.
