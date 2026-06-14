# Skill: Machine Learning & Data Science Tasks

## Description
This skill provides instructions for scaffolding and executing Machine Learning (ML), Deep Learning, and Data Science tasks. Use this skill when the user asks to "build an ML model", "train a neural network", "analyze a dataset", or "perform data science".

## Execution Steps

1. **Environment Setup:**
   Use the `native_shell` tool to create an isolated Python virtual environment to avoid dependency conflicts.
   - Command: `python -m venv venv`
   - For all subsequent Python commands, use the virtual environment's executable: `venv\Scripts\python.exe` (Windows) or `venv/bin/python` (Unix).
   - For pip installations, use: `venv\Scripts\pip.exe install ...` (Windows) or `venv/bin/pip install ...` (Unix).

2. **Install Dependencies:**
   - Use `native_shell` to install required ML libraries (e.g., `venv\Scripts\pip install numpy pandas scikit-learn torch torchvision matplotlib`).
   - Only install the libraries required for the specific task requested by the user.

3. **Project Structure:**
   Use the `make_directory` and `write_file` tools to create a clean, maintainable ML project structure:
   - `data/`: Directory for datasets.
   - `models/`: Directory to save trained model weights.
   - `src/data_loader.py`: Script for loading, cleaning, and preprocessing data.
   - `src/model.py`: Script defining the model architecture.
   - `src/train.py`: Script containing the training loop and optimization logic.
   - `src/evaluate.py`: Script for model evaluation, metrics, and inference.

4. **Code Implementation:**
   - Use `write_file` to write the Python scripts.
   - **Data Handling:** Ensure the code handles edge cases (e.g., checking if the data file exists before loading). If downloading data, write a script to download it automatically.
   - **Hardware Acceleration:** Always include device-agnostic code (e.g., `device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')` in PyTorch).
   - **Logging:** Include print statements or logging to output training progress (epoch, loss, accuracy).
   - **Persistence:** Ensure the trained model is saved to the `models/` directory at the end of training.

5. **Execution & Verification:**
   - Run the Python scripts using the `native_shell` tool.
   - Example: `venv\Scripts\python src\train.py`
   - Use `background: true` in the `native_shell` arguments if the training process is expected to be long-running, so it doesn't block the agent.

## Rules
- Never use raw shell `echo` to write Python code. Always use the `write_file` tool.
- Always use a virtual environment (`venv`) to prevent polluting the user's global Python environment.
- Do not attempt to process massive datasets in memory directly within the agent's context. Write Python scripts to handle the data processing natively.
- Ensure all generated Python code adheres to PEP 8 standards with strict, correct indentation.
