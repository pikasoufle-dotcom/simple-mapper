# 🎯 Simple Mapper

> La projection mapping sans complexité. Un projecteur, une idée, cinq minutes.

Simple Mapper est un outil de projection mapping **entièrement dans le navigateur**. Pas d'installation, pas de compte, pas de serveur. Un seul fichier HTML, un projecteur connecté, et vous êtes prêt à projeter.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Status](https://img.shields.io/badge/status-stable-green.svg)]()
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)]()

---

## ✨ Fonctionnalités

- **Warping mesh** : grille de 2×2 à 8×8 points pour épouser n'importe quelle surface
- **Médias** : import d'images et vidéos (drag-drop, URL, bibliothèque)
- **Multi-projecteurs** : jusqu'à 4 projecteurs avec edge blending (smoothstep)
- **Synchronisation temps réel** : BroadcastChannel entre éditeur et sorties
- **Sauvegarde** : autosave local + export/import ZIP avec médias
- **Effets** : miroir X/Y, contrôle vidéo in/out
- **Formes** : rectangle, cercle, texte
- **Undo/redo** : 50 étapes annulables (Ctrl+Z / Ctrl+Y)
- **Fonctionne hors ligne** : aucune connexion requise après chargement
- **Tablette compatible** : iPad et Android avec interface tactile adaptée

---

## 🚀 Démarrage rapide (5 minutes)

### Prérequis

- Un navigateur récent : **Chrome 110+**, **Firefox 115+**, **Edge 110+**, **Safari 16.4+**
- Un ordinateur avec au moins un port HDMI/USB-C libre
- Un projecteur (ou un second écran pour tester)

### Installation

```bash
# 1. Télécharger le projet
git clone https://github.com/votre-org/simple-mapper.git
cd simple-mapper

# 2. Lancer un serveur local (nécessaire pour le multi-fenêtres)
python -m http.server 8000
# ou : npx serve .
# ou : php -S localhost:8000