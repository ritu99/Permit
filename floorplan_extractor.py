"""
CubiCasa5K Floorplan Structured Extraction with DSPy + GEPA

This module extracts structured room/feature data from architectural floorplan images
using DSPy for programming language models and GEPA for prompt optimization.
"""

import re
import xml.etree.ElementTree as ET
from enum import Enum
from pathlib import Path
from typing import Optional

import dspy
from pydantic import BaseModel


# =============================================================================
# LLM Provider Configuration
# =============================================================================


class LLMProvider(Enum):
    """Supported LLM providers."""

    GEMINI = "gemini"
    OPENAI = "openai"
    OPENROUTER = "openrouter"


# Model mappings per provider (vision-capable models)
PROVIDER_MODELS = {
    LLMProvider.GEMINI: "gemini/gemini-3-pro-preview",
    LLMProvider.OPENAI: "openai/gpt-4o",
    LLMProvider.OPENROUTER: "openrouter/google/gemini-2.5-flash",
}


def configure_llm(provider: LLMProvider, model: str | None = None) -> dspy.LM:
    """Configure DSPy with the specified LLM provider.

    Args:
        provider: Which LLM provider to use
        model: Optional model override (uses default for provider if not specified)

    Returns:
        Configured dspy.LM instance
    """
    model_name = model or PROVIDER_MODELS[provider]
    lm = dspy.LM(
        model=model_name,
        num_retries=5,  # Retry on 429/5xx errors
    )
    dspy.configure(lm=lm)
    return lm


# =============================================================================
# Output Schema
# =============================================================================


class Room(BaseModel):
    """A single room in a floorplan."""

    type: str  # e.g., "bedroom", "bathroom", "kitchen", "living_room"
    area_sqft: Optional[float] = None


class FloorplanData(BaseModel):
    """Structured extraction output for a floorplan."""

    rooms: list[Room]
    total_rooms: int
    has_garage: bool
    num_bathrooms: int
    num_bedrooms: int


# =============================================================================
# DSPy Signature
# =============================================================================


class ExtractFloorplanData(dspy.Signature):
    """Extract structured room data from a floorplan image."""

    floorplan_image: dspy.Image = dspy.InputField(
        desc="Architectural floorplan image showing room layout"
    )
    extracted_data: FloorplanData = dspy.OutputField(
        desc="Structured room and feature data extracted from the floorplan"
    )


# =============================================================================
# DSPy Module
# =============================================================================


class FloorplanExtractor(dspy.Module):
    """DSPy module for extracting structured data from floorplan images."""

    def __init__(self):
        super().__init__()
        self.extractor = dspy.ChainOfThought(ExtractFloorplanData)

    def forward(self, floorplan_image: dspy.Image) -> FloorplanData:
        result = self.extractor(floorplan_image=floorplan_image)
        return result.extracted_data


# =============================================================================
# Data Loading Stubs
# =============================================================================

DATA_DIR = Path("data/cubicasa5k/cubicasa5k")

# Room type mapping from CubiCasa5K SVG classes to normalized names
ROOM_TYPE_MAP = {
    "bedroom": "bedroom",
    "bath": "bathroom",
    "kitchen": "kitchen",
    "livingroom": "living_room",
    "dining": "dining_room",
    "entry": "entry",
    "lobby": "lobby",
    "corridor": "corridor",
    "outdoor": "outdoor",
    "terrace": "terrace",
    "balcony": "balcony",
    "garage": "garage",
    "storage": "storage",
    "utility": "utility",
    "laundry": "laundry",
    "closet": "closet",
    "draughtlobby": "vestibule",
    "undefined": "other",
}


def load_split(split: str, limit: Optional[int] = None) -> list[dspy.Example]:
    """Load train/val/test split from CubiCasa5K dataset.

    Args:
        split: One of 'train', 'val', 'test'
        limit: Optional limit on number of examples to load

    Returns:
        List of dspy.Example with:
            - floorplan_image: dspy.Image
            - extracted_data: FloorplanData (ground truth label)
    """
    if split not in ("train", "val", "test"):
        raise ValueError(f"split must be 'train', 'val', or 'test', got {split!r}")

    # Read the split file to get list of floorplan paths
    split_file = DATA_DIR / f"{split}.txt"
    if not split_file.exists():
        raise FileNotFoundError(f"Split file not found: {split_file}")

    with open(split_file) as f:
        floorplan_paths = [line.strip() for line in f if line.strip()]

    examples = []
    for rel_path in floorplan_paths:
        if limit and len(examples) >= limit:
            break

        # rel_path is like "/high_quality_architectural/6044/"
        floorplan_dir = DATA_DIR / rel_path.strip("/")

        image_path = floorplan_dir / "F1_original.png"
        annotation_path = floorplan_dir / "model.svg"

        if not image_path.exists() or not annotation_path.exists():
            continue

        try:
            label = parse_annotation(annotation_path)
            image = dspy.Image(str(image_path))

            examples.append(
                dspy.Example(
                    floorplan_image=image,
                    extracted_data=label,
                ).with_inputs("floorplan_image")
            )
        except Exception as e:
            # Skip problematic files
            print(f"Warning: Could not load {floorplan_dir}: {e}")
            continue

    return examples


def parse_annotation(svg_path: Path) -> FloorplanData:
    """Parse CubiCasa5K SVG annotation to extract ground truth labels.

    Args:
        svg_path: Path to the annotation SVG file

    Returns:
        FloorplanData with room types and counts
    """
    tree = ET.parse(svg_path)
    root = tree.getroot()

    # SVG namespace handling
    ns = {"svg": "http://www.w3.org/2000/svg"}

    rooms = []
    num_bedrooms = 0
    num_bathrooms = 0
    has_garage = False

    # Find all Space elements (rooms) by looking for class attributes containing "Space"
    for elem in root.iter():
        class_attr = elem.get("class", "")

        # Look for Space elements which define rooms
        if "Space" in class_attr:
            # Parse the class to extract room type
            # Format: "Space Category Type" e.g., "Space Outdoor Terrace"
            parts = class_attr.split()

            if len(parts) >= 2:
                # Get the room type (last meaningful part after "Space")
                room_type_raw = parts[-1].lower() if len(parts) > 1 else "other"

                # Also check category (second part) for context
                category = parts[1].lower() if len(parts) > 2 else ""

                # Normalize the room type
                room_type = ROOM_TYPE_MAP.get(room_type_raw, room_type_raw)

                # Also map category-based types
                if category in ROOM_TYPE_MAP:
                    room_type = ROOM_TYPE_MAP.get(category, room_type)

                rooms.append(Room(type=room_type))

                # Count specific room types
                if room_type == "bedroom":
                    num_bedrooms += 1
                elif room_type == "bathroom":
                    num_bathrooms += 1
                elif room_type == "garage":
                    has_garage = True

    return FloorplanData(
        rooms=rooms,
        total_rooms=len(rooms),
        has_garage=has_garage,
        num_bathrooms=num_bathrooms,
        num_bedrooms=num_bedrooms,
    )


# =============================================================================
# GEPA Optimization
# =============================================================================


def extraction_metric(
    gold: dspy.Example,
    pred,
    trace=None,
    pred_name=None,
    pred_trace=None,
):
    """Compute extraction quality metric for GEPA optimization.

    Args:
        gold: Ground truth example with extracted_data
        pred: Model prediction (FloorplanData or wrapper with extracted_data)
        trace: Execution trace (for GEPA)

    Returns:
        float score (0-1) for basic eval, or dict with 'score' and 'feedback' for GEPA
    """
    gold_data: FloorplanData = gold.extracted_data
    # Handle both direct FloorplanData and Prediction wrapper
    if isinstance(pred, FloorplanData):
        pred_data = pred
    elif hasattr(pred, 'extracted_data'):
        pred_data = pred.extracted_data
    else:
        # Fallback: return failure
        if trace is not None:
            return {"score": 0.0, "feedback": f"Invalid prediction type: {type(pred)}"}
        return 0.0

    score = 0.0
    feedback = []

    # Check room count match (25%)
    if gold_data.total_rooms == pred_data.total_rooms:
        score += 0.25
    else:
        feedback.append(
            f"Room count mismatch: expected {gold_data.total_rooms}, got {pred_data.total_rooms}"
        )

    # Check bedroom count (25%)
    if gold_data.num_bedrooms == pred_data.num_bedrooms:
        score += 0.25
    else:
        feedback.append(
            f"Bedroom count mismatch: expected {gold_data.num_bedrooms}, got {pred_data.num_bedrooms}"
        )

    # Check bathroom count (25%)
    if gold_data.num_bathrooms == pred_data.num_bathrooms:
        score += 0.25
    else:
        feedback.append(
            f"Bathroom count mismatch: expected {gold_data.num_bathrooms}, got {pred_data.num_bathrooms}"
        )

    # Check room type coverage (25%)
    gold_types = {r.type.lower() for r in gold_data.rooms}
    pred_types = {r.type.lower() for r in pred_data.rooms}
    if gold_types:
        overlap = len(gold_types & pred_types) / len(gold_types)
        score += 0.25 * overlap
        if overlap < 1.0:
            missing = gold_types - pred_types
            feedback.append(f"Missing room types: {missing}")
    else:
        score += 0.25  # No rooms to match

    # Return dict for GEPA (when trace is provided), float for basic eval
    if trace is not None or pred_trace is not None:
        return {
            "score": score,
            "feedback": "\n".join(feedback) if feedback else "Good extraction",
        }
    return score


def optimize_with_gepa(
    trainset: list[dspy.Example],
    valset: list[dspy.Example],
    budget: str = "medium",
    provider: LLMProvider = LLMProvider.GEMINI,
    num_threads: int = 4,
) -> FloorplanExtractor:
    """Optimize FloorplanExtractor using GEPA.

    Args:
        trainset: Training examples
        valset: Validation examples
        budget: GEPA budget preset ("light", "medium", "heavy")
        provider: LLM provider for reflection
        num_threads: Number of parallel threads for evaluation

    Returns:
        Optimized FloorplanExtractor module
    """
    reflection_model = PROVIDER_MODELS[provider]
    optimizer = dspy.GEPA(
        metric=extraction_metric,
        auto=budget,
        reflection_lm=dspy.LM(model=reflection_model, temperature=1.0, num_retries=5),
        num_threads=num_threads,
        track_stats=True,
    )

    optimized = optimizer.compile(
        student=FloorplanExtractor(),
        trainset=trainset,
        valset=valset,
    )

    return optimized


# =============================================================================
# Evaluation
# =============================================================================


def evaluate(extractor: FloorplanExtractor, split: str = "test") -> dict:
    """Evaluate extractor on a data split.

    Args:
        extractor: The FloorplanExtractor to evaluate
        split: Which split to evaluate on ('train', 'val', 'test')

    Returns:
        Dict with aggregate metrics
    """
    testset = load_split(split)

    if not testset:
        raise ValueError(f"No examples found for split '{split}'")

    total_score = 0.0
    results = []

    for example in testset:
        pred = extractor(floorplan_image=example.floorplan_image)
        pred_example = dspy.Prediction(extracted_data=pred)
        metric_result = extraction_metric(example, pred_example)
        total_score += metric_result["score"]
        results.append(metric_result)

    return {
        "split": split,
        "num_examples": len(testset),
        "avg_score": total_score / len(testset),
        "results": results,
    }


# =============================================================================
# Save/Load Optimized Models
# =============================================================================


def save_model(extractor: FloorplanExtractor, path: str = "optimized_extractor"):
    """Save optimized extractor to disk."""
    extractor.save(path)
    print(f"Model saved to {path}/")


def load_model(path: str = "optimized_extractor") -> FloorplanExtractor:
    """Load optimized extractor from disk.

    Supports both DSPy native format and custom state.json format.
    """
    import json
    from pathlib import Path

    extractor = FloorplanExtractor()
    state_path = Path(path) / "state.json"

    if state_path.exists():
        # Load from our custom state.json format
        with open(state_path) as f:
            state = json.load(f)

        # Apply the optimized instruction to the predictor
        if "extractor" in state and "predict" in state["extractor"]:
            instruction = state["extractor"]["predict"].get("instruction", "")
            if instruction:
                # ChainOfThought wraps a Predict module, access via .predict.signature
                extractor.extractor.predict.signature = extractor.extractor.predict.signature.with_instructions(instruction)
        print(f"Model loaded from {path}/ (custom format)")
    else:
        # Fall back to DSPy native format
        extractor.load(path)
        print(f"Model loaded from {path}/ (DSPy format)")

    return extractor


# =============================================================================
# CLI
# =============================================================================

import typer
from dotenv import load_dotenv

app = typer.Typer(help="Floorplan structured extraction with DSPy + GEPA")


@app.command()
def optimize(
    provider: str = typer.Option("gemini", help="LLM provider: gemini, openai, openrouter"),
    budget: str = typer.Option("medium", help="GEPA budget: light, medium, heavy"),
    train_limit: int = typer.Option(50, help="Max training examples"),
    val_limit: int = typer.Option(20, help="Max validation examples"),
    threads: int = typer.Option(4, help="Parallel threads"),
    output: str = typer.Option("optimized_extractor", help="Output path for saved model"),
):
    """Run GEPA optimization on the floorplan extractor."""
    load_dotenv()

    llm_provider = LLMProvider(provider)
    configure_llm(llm_provider)
    print(f"Using LLM: {PROVIDER_MODELS[llm_provider]}")

    print(f"\nLoading data (train={train_limit}, val={val_limit})...")
    trainset = load_split("train", limit=train_limit)
    valset = load_split("val", limit=val_limit)
    print(f"  Loaded {len(trainset)} train, {len(valset)} val examples")

    print(f"\nOptimizing with GEPA (budget={budget}, threads={threads})...")
    optimized = optimize_with_gepa(
        trainset, valset, budget=budget, provider=llm_provider, num_threads=threads
    )

    save_model(optimized, output)
    print(f"\nDone! Model saved to {output}/")


@app.command()
def eval(
    provider: str = typer.Option("gemini", help="LLM provider: gemini, openai, openrouter"),
    model_path: str = typer.Option("optimized_extractor", help="Path to saved model"),
    split: str = typer.Option("test", help="Split to evaluate: train, val, test"),
    limit: int = typer.Option(50, help="Max examples to evaluate"),
):
    """Evaluate a saved model on a data split."""
    load_dotenv()

    llm_provider = LLMProvider(provider)
    configure_llm(llm_provider)

    print(f"Loading model from {model_path}/...")
    extractor = load_model(model_path)

    print(f"Evaluating on {split} (limit={limit})...")
    results = evaluate(extractor, split=split)
    print(f"\nResults: {results['avg_score']:.2%} average score")


@app.command()
def test_single(
    image_path: str = typer.Argument(..., help="Path to floorplan image"),
    provider: str = typer.Option("gemini", help="LLM provider"),
    model_path: str = typer.Option("optimized_extractor", help="Path to saved model"),
):
    """Test extraction on a single image."""
    load_dotenv()

    llm_provider = LLMProvider(provider)
    configure_llm(llm_provider)

    extractor = load_model(model_path)
    image = dspy.Image(image_path)

    result = extractor(floorplan_image=image)
    print(f"\nExtracted data:")
    print(f"  Total rooms: {result.total_rooms}")
    print(f"  Bedrooms: {result.num_bedrooms}")
    print(f"  Bathrooms: {result.num_bathrooms}")
    print(f"  Has garage: {result.has_garage}")
    print(f"  Room types: {[r.type for r in result.rooms]}")


if __name__ == "__main__":
    app()
