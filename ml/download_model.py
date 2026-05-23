"""
Запусти ОДИН РАЗ перед хакатоном:
    python ml/download_model.py

Скачивает Qwen3-4B-Instruct в локальный кэш HuggingFace (~8 ГБ).
После этого модель работает полностью офлайн.
"""

from huggingface_hub import snapshot_download
import os

MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"

print(f"Скачиваем {MODEL_ID}...")
print("Размер: ~8 ГБ. Один раз — больше не нужно.\n")

path = snapshot_download(
    repo_id=MODEL_ID,
    ignore_patterns=["*.msgpack", "*.h5", "flax_model*", "tf_model*"],
)

print(f"\n✓ Готово. Модель сохранена в: {path}")
