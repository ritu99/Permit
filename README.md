# Floorplan Structured Extraction

Extract structured room data from architectural floorplan images using DSPy and GEPA optimization.

## Overview

This project uses vision-capable LLMs to extract structured data from Finnish floorplan images (CubiCasa5K dataset). The extraction pipeline is built with [DSPy](https://dspy.ai/) and optimized using [GEPA](https://github.com/stanfordnlp/dspy) (Genetic-Pareto prompt optimization).

**Results:**
- Baseline accuracy: 37.0%
- Optimized accuracy: **55.8%** (+18.8% improvement)

## Installation

```bash
# Install uv (fast Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies
uv sync
```

## Quick Start

```python
from floorplan_extractor import load_model, configure_llm, LLMProvider
import dspy

# Configure LLM provider
configure_llm(LLMProvider.GEMINI)  # or OPENROUTER, OPENAI

# Load optimized model
extractor = load_model("optimized_extractor")

# Extract from floorplan image
image = dspy.Image("path/to/floorplan.png")
result = extractor(floorplan_image=image)

print(f"Rooms: {result.total_rooms}")
print(f"Bedrooms: {result.num_bedrooms}")
print(f"Bathrooms: {result.num_bathrooms}")
print(f"Has garage: {result.has_garage}")
```

## CLI Usage

```bash
# Test on a single image
uv run python floorplan_extractor.py test-single path/to/image.png --provider gemini

# Run GEPA optimization (requires dataset)
uv run python floorplan_extractor.py optimize --provider gemini --budget medium

# Evaluate model on test set
uv run python floorplan_extractor.py eval --provider gemini --split test
```

## Output Schema

```python
class Room:
    type: str           # e.g., "bedroom", "bathroom", "kitchen"
    area_sqft: float    # Area in square feet (or None)

class FloorplanData:
    rooms: list[Room]   # All identified rooms
    total_rooms: int    # Count of rooms
    has_garage: bool    # Whether garage is present
    num_bathrooms: int  # Number of bathrooms
    num_bedrooms: int   # Number of bedrooms
```

## LLM Providers

| Provider | Model | Environment Variable |
|----------|-------|---------------------|
| Gemini | gemini-3-pro-preview | `GEMINI_API_KEY` |
| OpenAI | gpt-4o | `OPENAI_API_KEY` |
| OpenRouter | gemini-2.5-flash | `OPENROUTER_API_KEY` |

Configure in `.env`:
```
GEMINI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
```

## Dataset

Uses [CubiCasa5K](https://www.kaggle.com/datasets/qmarva/cubicasa5k) - 5,000 annotated Finnish floorplan images.

```
data/cubicasa5k/cubicasa5k/
├── train.txt          # 4,199 training examples
├── val.txt            # 399 validation examples
├── test.txt           # 399 test examples
├── high_quality_architectural/
└── high_quality/
```

## Optimized Prompt

GEPA discovered an optimized prompt that handles Finnish room labels:

| Finnish | English |
|---------|---------|
| OH, Olohuone | living_room |
| MH, Makuuhuone | bedroom |
| K, Keittiö, KK | kitchen |
| KPH, KH, WC | bathroom |
| VH | closet |
| ET, TK | entry |
| Parveke | outdoor (balcony) |
| AT, Autotalli | garage |
| S, Sauna | other |

Key rules learned:
- **Studio apartments**: "1H" = living room (0 bedrooms)
- **Open-plan kitchens**: Segment as separate room if visually distinct
- **Area conversion**: 1 m² = 10.764 sqft

See full prompt: [`optimized_extractor/prompt.txt`](optimized_extractor/prompt.txt)

## Project Structure

```
.
├── floorplan_extractor.py    # Main extraction module
├── optimized_extractor/      # Saved optimized model
│   ├── metadata.json         # Optimization stats
│   ├── state.json            # DSPy-loadable state
│   └── prompt.txt            # Human-readable prompt
├── data/cubicasa5k/          # Dataset (download separately)
├── pyproject.toml            # Dependencies
└── .env                      # API keys (not committed)
```

## Dependencies

- `dspy>=3.0.4` - LLM programming framework
- `gepa>=0.0.17` - GEPA optimizer
- `typer>=0.20.0` - CLI framework
- `pillow>=12.0.0` - Image processing
- `python-dotenv>=1.2.1` - Environment variables
