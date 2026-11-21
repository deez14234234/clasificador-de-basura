"""Entrena un modelo ligero para Raspberry Pi 4 por destilacion de conocimiento.

El modelo grande del proyecto principal (EfficientNetV2-S, 96,8 % en test) no
cabe en el presupuesto de una Pi 4: son 80 MB y unos 8 GFLOPs por imagen, que
en un Cortex-A72 sin acelerador se traducen en varios segundos por fotograma.

En lugar de entrenar uno pequeno desde cero, se usa el grande como maestro:
el alumno aprende de la distribucion completa de probabilidades del maestro
--no solo de la etiqueta correcta-- y eso transmite informacion que la
etiqueta dura no tiene. Saber que una foto es "carton con un 70 % y papel con
un 25 %" le ensena al alumno que esos dos materiales se parecen, algo que
"carton" a secas no dice. Con el mismo dataset y el mismo presupuesto de
parametros, el alumno destilado suele sacar varios puntos mas que el entrenado
solo con etiquetas.

Uso:
    python ml/destilar.py --arch mobilenetv4_conv_small
    python ml/destilar.py --arch efficientnet_lite0 --img-size 192
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms

sys.path.insert(0, str(Path(__file__).resolve().parent))
from taxonomy import COLOR_ORDER, MATERIAL_CLASSES, MATERIAL_TO_COLOR

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


@dataclass
class Config:
    data_dir: Path
    teacher_ckpt: Path
    out_dir: Path
    arch: str = "mobilenetv4_conv_small"
    img_size: int = 224
    epochs: int = 20
    batch_size: int = 96
    lr: float = 1.2e-3
    weight_decay: float = 2e-5
    warmup_epochs: int = 2
    label_smoothing: float = 0.1
    # Temperatura de destilacion: suaviza las probabilidades del maestro para
    # que las clases no ganadoras aporten senal. Con T=1 casi todo el peso se
    # va a la clase ganadora y la destilacion deja de anadir informacion.
    temperatura: float = 4.0
    # Peso de la perdida de destilacion frente a la de etiquetas duras.
    alfa: float = 0.75
    workers: int = 6
    seed: int = 42
    # 0 = sin parada temprana, que es el valor por defecto a proposito.
    #
    # La tasa de aprendizaje sigue un coseno que recorre TODAS las epocas, asi
    # que el modelo no converge hasta que la tasa baja, cerca del final. Una
    # parada por paciencia mide el progreso justo en la fase de tasa alta,
    # donde las metricas de validacion rebotan sin tendencia, y corta antes de
    # que el coseno haga su trabajo: con 34 epocas y paciencia 8 este
    # entrenamiento paraba en la 12 y daba 1,6 puntos MENOS que uno de 16
    # epocas completas. Si se activa, conviene una paciencia del orden de la
    # mitad de las epocas.
    patience: int = 0


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


# --------------------------------------------------------------------------- #
# Datos
# --------------------------------------------------------------------------- #
def build_transforms(img_size: int):
    train_tf = transforms.Compose([
        transforms.RandomResizedCrop(img_size, scale=(0.6, 1.0), ratio=(0.8, 1.25)),
        transforms.RandomHorizontalFlip(),
        transforms.TrivialAugmentWide(),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        transforms.RandomErasing(p=0.15, scale=(0.02, 0.12)),
    ])
    eval_tf = transforms.Compose([
        transforms.Resize(round(img_size * 240 / 224)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])
    return train_tf, eval_tf


def build_loaders(cfg: Config):
    train_tf, eval_tf = build_transforms(cfg.img_size)
    train_ds = datasets.ImageFolder(cfg.data_dir / "train", transform=train_tf)
    valid_ds = datasets.ImageFolder(cfg.data_dir / "valid", transform=eval_tf)

    # El orden de las clases decide el mapa indice -> color en el dispositivo.
    # Si dejara de coincidir, la Pi mostraria colores equivocados en silencio.
    if train_ds.classes != MATERIAL_CLASSES:
        raise SystemExit(
            f"Clases en disco {train_ds.classes} != taxonomia {MATERIAL_CLASSES}")
    if valid_ds.classes != MATERIAL_CLASSES:
        raise SystemExit("Las clases de valid no coinciden con las de train.")

    comun = dict(num_workers=cfg.workers, pin_memory=True,
                 persistent_workers=cfg.workers > 0)
    return (
        DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True,
                   drop_last=True, **comun),
        DataLoader(valid_ds, batch_size=cfg.batch_size * 2, shuffle=False, **comun),
        train_ds.classes,
    )


def class_weights(train_dir: Path, classes: list[str]) -> torch.Tensor:
    """Pesos ~ 1/sqrt(frecuencia): compensa el desbalance sin pasarse."""
    counts = np.array([len(list((train_dir / c).iterdir())) for c in classes],
                      dtype=np.float64)
    w = 1.0 / np.sqrt(counts)
    return torch.tensor(w / w.mean(), dtype=torch.float32)


# --------------------------------------------------------------------------- #
# Modelos
# --------------------------------------------------------------------------- #
def cargar_maestro(ckpt_path: Path, n_clases: int, device: torch.device) -> nn.Module:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    if ckpt["arch"] != "efficientnet_v2_s":
        raise SystemExit(f"Maestro inesperado: {ckpt['arch']}")
    if ckpt["classes"] != MATERIAL_CLASSES:
        raise SystemExit(
            "El maestro fue entrenado con otras clases que la taxonomia de esta "
            f"carpeta.\n  maestro : {ckpt['classes']}\n  aqui    : {MATERIAL_CLASSES}")

    modelo = models.efficientnet_v2_s(weights=None)
    idx = max(i for i, m in enumerate(modelo.classifier) if isinstance(m, nn.Linear))
    modelo.classifier[idx] = nn.Linear(modelo.classifier[idx].in_features, n_clases)
    modelo.load_state_dict(ckpt["state_dict"])
    modelo.eval().to(device, memory_format=torch.channels_last)
    for p in modelo.parameters():
        p.requires_grad_(False)
    return modelo


def crear_alumno(arch: str, n_clases: int) -> nn.Module:
    return timm.create_model(arch, pretrained=True, num_classes=n_clases)


def resumen_modelo(modelo: nn.Module, img_size: int) -> dict:
    params = sum(p.numel() for p in modelo.parameters())
    # MB en float32; el ONNX int8 queda aproximadamente en la cuarta parte.
    return {"parametros": params, "mb_fp32": round(params * 4 / 1e6, 1),
            "img_size": img_size}


# --------------------------------------------------------------------------- #
# Metricas
# --------------------------------------------------------------------------- #
COLOR_OF_INDEX = torch.tensor(
    [COLOR_ORDER.index(MATERIAL_TO_COLOR[m]) for m in MATERIAL_CLASSES],
    dtype=torch.long)


def macro_f1(cm: np.ndarray) -> float:
    f1 = []
    for i in range(cm.shape[0]):
        tp = cm[i, i]
        denom = 2 * tp + (cm[:, i].sum() - tp) + (cm[i, :].sum() - tp)
        f1.append(0.0 if denom == 0 else 2 * tp / denom)
    return float(np.mean(f1))


@torch.no_grad()
def evaluar(modelo: nn.Module, loader: DataLoader, device: torch.device) -> dict:
    modelo.eval()
    n = len(MATERIAL_CLASSES)
    cm = np.zeros((n, n), dtype=np.int64)
    color_of = COLOR_OF_INDEX.to(device)
    aciertos_color = total = 0

    for x, y in loader:
        x = x.to(device, non_blocking=True, memory_format=torch.channels_last)
        y = y.to(device, non_blocking=True)
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
            pred = modelo(x).float().argmax(1)
        aciertos_color += (color_of[pred] == color_of[y]).sum().item()
        total += y.size(0)
        for t, p in zip(y.cpu().numpy(), pred.cpu().numpy()):
            cm[t, p] += 1

    return {"acc": float(np.trace(cm) / max(total, 1)),
            "macro_f1": macro_f1(cm),
            "color_acc": aciertos_color / max(total, 1)}


# --------------------------------------------------------------------------- #
# Entrenamiento
# --------------------------------------------------------------------------- #
def entrenar(cfg: Config) -> dict:
    seed_everything(cfg.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.backends.cudnn.benchmark = True
        torch.backends.cuda.matmul.allow_tf32 = True
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    train_dl, valid_dl, clases = build_loaders(cfg)
    maestro = cargar_maestro(cfg.teacher_ckpt, len(clases), device)
    alumno = crear_alumno(cfg.arch, len(clases)).to(device, memory_format=torch.channels_last)

    info = resumen_modelo(alumno, cfg.img_size)
    print(f"alumno {cfg.arch}: {info['parametros']/1e6:.2f} M parametros "
          f"({info['mb_fp32']} MB en fp32) a {cfg.img_size} px")
    print(f"train {len(train_dl.dataset)} | valid {len(valid_dl.dataset)}")

    pesos = class_weights(cfg.data_dir / "train", clases).to(device)
    ce = nn.CrossEntropyLoss(weight=pesos, label_smoothing=cfg.label_smoothing)

    decay, no_decay = [], []
    for p in alumno.parameters():
        if p.requires_grad:
            (no_decay if p.ndim <= 1 else decay).append(p)
    opt = torch.optim.AdamW(
        [{"params": decay, "weight_decay": cfg.weight_decay},
         {"params": no_decay, "weight_decay": 0.0}], lr=cfg.lr)

    pasos = len(train_dl)
    calentamiento = max(1, cfg.warmup_epochs * pasos)
    total_pasos = cfg.epochs * pasos

    def factor_lr(paso: int) -> float:
        if paso < calentamiento:
            return paso / calentamiento
        avance = (paso - calentamiento) / max(1, total_pasos - calentamiento)
        return 0.5 * (1 + np.cos(np.pi * min(1.0, avance)))

    sched = torch.optim.lr_scheduler.LambdaLR(opt, factor_lr)

    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    destino = cfg.out_dir / f"{cfg.arch}_{cfg.img_size}.pt"
    historial: list[dict] = []
    mejor_f1, mejor_epoca, sin_mejora = -1.0, -1, 0
    t0 = time.time()
    T = cfg.temperatura

    for epoca in range(1, cfg.epochs + 1):
        alumno.train()
        suma = vistos = aciertos = 0.0
        ini = time.time()

        for i, (x, y) in enumerate(train_dl, 1):
            x = x.to(device, non_blocking=True, memory_format=torch.channels_last)
            y = y.to(device, non_blocking=True)

            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device.type == "cuda"):
                # El maestro ve exactamente la misma imagen aumentada que el
                # alumno; con otra vista, sus logits no describirian esta.
                with torch.no_grad():
                    logits_maestro = maestro(x).float()
                logits = alumno(x)

            logits = logits.float()
            perdida_dura = ce(logits, y)
            # KL con temperatura. El factor T^2 mantiene la magnitud del
            # gradiente comparable a la de la perdida dura al variar T.
            perdida_blanda = F.kl_div(
                F.log_softmax(logits / T, dim=1),
                F.log_softmax(logits_maestro / T, dim=1),
                reduction="batchmean", log_target=True) * (T * T)
            perdida = cfg.alfa * perdida_blanda + (1 - cfg.alfa) * perdida_dura

            opt.zero_grad(set_to_none=True)
            perdida.backward()
            torch.nn.utils.clip_grad_norm_(alumno.parameters(), 5.0)
            opt.step()
            sched.step()

            suma += perdida.item() * y.size(0)
            aciertos += (logits.argmax(1) == y).sum().item()
            vistos += y.size(0)
            if i % 50 == 0 or i == pasos:
                print(f"\r  ep {epoca:02d}/{cfg.epochs}  {i:>4}/{pasos}  "
                      f"perdida {suma/vistos:.4f}  acc {aciertos/vistos:.4f}",
                      end="", flush=True)

        val = evaluar(alumno, valid_dl, device)
        dur = time.time() - ini
        print(f"\r  ep {epoca:02d}/{cfg.epochs}  perdida {suma/vistos:.4f}  "
              f"acc {aciertos/vistos:.4f}  |  val_acc {val['acc']:.4f}  "
              f"macroF1 {val['macro_f1']:.4f}  color {val['color_acc']:.4f}  ({dur:.0f}s)")

        historial.append({"epoca": epoca, "perdida": suma / vistos,
                          "train_acc": aciertos / vistos, **val,
                          "segundos": round(dur, 1)})

        if val["macro_f1"] > mejor_f1:
            mejor_f1, mejor_epoca, sin_mejora = val["macro_f1"], epoca, 0
            torch.save({"state_dict": alumno.state_dict(), "arch": cfg.arch,
                        "classes": clases, "img_size": cfg.img_size,
                        "normalization": {"mean": IMAGENET_MEAN, "std": IMAGENET_STD},
                        "material_to_color": MATERIAL_TO_COLOR,
                        "epoch": epoca, "val_metrics": val,
                        "info": info,
                        "config": {k: str(v) if isinstance(v, Path) else v
                                   for k, v in asdict(cfg).items()}}, destino)
            print(f"      nuevo mejor macro-F1 -> {destino.name}")
        else:
            sin_mejora += 1
            if cfg.patience and sin_mejora >= cfg.patience:
                print(f"      sin mejora en {cfg.patience} epocas; parada temprana")
                break

    minutos = (time.time() - t0) / 60
    print(f"\nTerminado en {minutos:.1f} min. Mejor macro-F1 {mejor_f1:.4f} "
          f"(epoca {mejor_epoca}).")

    resumen = {"arch": cfg.arch, "img_size": cfg.img_size, "info": info,
               "mejor_macro_f1": mejor_f1, "mejor_epoca": mejor_epoca,
               "minutos": round(minutos, 1), "historial": historial,
               "checkpoint": str(destino)}
    (cfg.out_dir / f"historial_{cfg.arch}_{cfg.img_size}.json").write_text(
        json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8")
    return resumen


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    principal = base.parent / "Reciclaje_basura"
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arch", default="mobilenetv4_conv_small")
    ap.add_argument("--img-size", type=int, default=224)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch-size", type=int, default=96)
    ap.add_argument("--lr", type=float, default=1.2e-3)
    ap.add_argument("--alfa", type=float, default=0.75)
    ap.add_argument("--temperatura", type=float, default=4.0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--patience", type=int, default=0,
                    help="0 = sin parada temprana (recomendado con coseno)")
    ap.add_argument("--data-dir", type=Path,
                    default=principal / "data" / "processed" / "ntp")
    ap.add_argument("--teacher", type=Path,
                    default=principal / "artifacts" / "model_best.pt")
    ap.add_argument("--out-dir", type=Path, default=base / "artifacts")
    args = ap.parse_args()

    if not args.data_dir.exists():
        raise SystemExit(f"No existe {args.data_dir}. Prepara el dataset en el "
                         "proyecto principal (ml/prepare_dataset.py).")
    if not args.teacher.exists():
        raise SystemExit(f"No existe el maestro {args.teacher}. Entrena primero "
                         "el modelo grande (Reciclaje_basura/ml/train.py).")

    entrenar(Config(
        data_dir=args.data_dir, teacher_ckpt=args.teacher, out_dir=args.out_dir,
        arch=args.arch, img_size=args.img_size, epochs=args.epochs,
        batch_size=args.batch_size, lr=args.lr, alfa=args.alfa,
        temperatura=args.temperatura, workers=args.workers,
        patience=args.patience))


if __name__ == "__main__":
    main()
