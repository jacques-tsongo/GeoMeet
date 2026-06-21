# GeoMeet

GeoMeet est une application web moderne de partage temporaire de localisation en temps reel entre deux utilisateurs.

## Installation

1. Installer les dependances :

```bash
npm install
```

2. Creer la base MySQL :

```bash
mysql -u root -p < database/schema.sql
```

3. Copier l'environnement :

```bash
cp .env.example .env
```

4. Modifier `.env` avec vos identifiants MySQL, puis lancer :

```bash
npm run dev
```

L'application sera disponible sur `http://localhost:5000`.

## Fonctionnalites

- Inscription et connexion avec JWT.
- Recherche d'utilisateurs.
- Demandes de rencontre avec acceptation/refus.
- Sessions de rencontre actives.
- Partage de localisation en temps reel avec Socket.IO.
- Carte Leaflet affichant les deux positions, distance et itineraire OSRM.
- Tableau de bord responsive avec demandes, sessions et utilisateurs en ligne.
