# PayBF

Infrastructure de paiement **developer-first** pour le Burkina Faso et l'Afrique francophone : une seule API pour accepter plusieurs moyens de paiement.

> **SANDBOX uniquement.** Les paiements sont simulés, aucun fonds réel ne circule, et PayBF n'est pas un établissement agréé. L'architecture prépare l'intégration future de prestataires de paiement légalement autorisés.

Voir `PayBF-conception.md` pour le dossier de conception complet.

## Statut

- Phase 1 terminée : squelette monorepo, schéma Prisma, endpoint `/health`, Docker Compose.
- Phase 2 : authentification (JWT + refresh rotatif, Argon2id), rôles et permissions, marchands, applications, journal d'audit.

## API dashboard (phase 2)

Préfixe `/api/v1`. Documentation Swagger sur `/docs`.

| Méthode | Route | Rôle requis |
|---|---|---|
| POST | `/dashboard/auth/register` | public |
| POST | `/dashboard/auth/login` | public |
| POST | `/dashboard/auth/refresh` | public (refresh token) |
| POST | `/dashboard/auth/logout` | public (refresh token) |
| GET | `/dashboard/auth/me` | connecté |
| GET | `/dashboard/merchant` | `merchant:read` |
| GET, POST | `/dashboard/applications` | `applications:read` / `applications:write` |
| GET | `/dashboard/applications/:id` | `applications:read` |

Exemple :

```bash
curl -X POST http://localhost:3000/api/v1/dashboard/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"un-mot-de-passe-solide","name":"Dev","merchantName":"Ma Boutique"}'
```

Le `merchantId` utilisé pour filtrer les données vient toujours du jeton, jamais de la requête : un marchand ne peut pas lire les données d'un autre.

## Clés API et API publique (phases 3 et 4)

Les clés se gèrent depuis le dashboard (JWT) : `POST /dashboard/api-keys` (le champ `secret` n'est renvoyé qu'à la création), `POST /dashboard/api-keys/:id/rotate` (l'ancienne clé reste valable 24 h), `DELETE /dashboard/api-keys/:id` (révocation immédiate).

L'API publique s'appelle avec `Authorization: Bearer sk_test_...`.

| Méthode | Route | Permission de la clé |
|---|---|---|
| POST | `/payments` | `payments:write` |
| GET | `/payments`, `/payments/:id` | `payments:read` |
| POST | `/payments/:id/cancel` | `payments:write` |
| POST | `/customers` | `customers:write` |
| GET | `/customers/:id` | `customers:read` |
| GET | `/providers` | toute clé (même `pk_`) |

### Idempotence

Envoyez un en-tête `Idempotency-Key` unique par opération :

- même clé et même corps : **une seule transaction** est créée, les appels suivants renvoient la réponse d'origine (en-tête `Idempotent-Replayed: true`) ;
- même clé avec un corps différent : `409 idempotency_key_reuse` ;
- requête identique encore en cours : `409 request_in_progress` ;
- si la création échoue, la clé est libérée et vous pouvez réessayer ;
- une clé expire après 24 h ; elle est propre à chaque marchand.

### Sandbox : numéros de test

| Numéro | Résultat |
|---|---|
| `70000001` | SUCCESS |
| `70000002` | FAILED (solde insuffisant) |
| `70000003` | PENDING |
| `70000004` | timeout du prestataire (le paiement reste PENDING) |
| autre numéro | SUCCESS |

Cartes : jetons `tok_success`, `tok_declined`, `tok_pending`, `tok_timeout`. Aucun numéro de carte réel ne doit être envoyé.

### Limites de débit

Par défaut 120 requêtes/minute par clé API (`RATE_LIMIT_PER_MINUTE`). Routes d'authentification et de checkout : limitées par IP. Au-delà : `429` avec l'en-tête `Retry-After`.

### Format d'erreur

```json
{ "error": { "status": 409, "code": "idempotency_key_reuse", "message": "...", "correlation_id": "req_..." } }
```

## Seed

```bash
npm run prisma:seed -w backend   # plans FREE/STARTER/BUSINESS/ENTERPRISE (+ admin si SEED_ADMIN_* défini)
```

## Démarrage rapide (développement)

```bash
cp .env.example .env          # puis adapter les secrets
npm install
npm run prisma:generate -w backend
npm run test                  # tests unitaires backend
npm run dev:backend           # API sur http://localhost:4000
npm run dev:frontend          # UI sur http://localhost:5173
```

## Docker

```bash
cp .env.example .env          # définir POSTGRES_PASSWORD et les secrets JWT
docker compose up --build     # point d'entrée : http://localhost:3000
```

Les migrations sont appliquées au démarrage du backend (`prisma migrate deploy`).

## Variables d'environnement

Voir `.env.example`. Aucun secret ne doit être committé : `.env` est ignoré par Git. L'application refuse de démarrer si la configuration est invalide ou si `PAYBF_ENV` n'est pas `sandbox`.

## Structure

```
backend/   API NestJS + Prisma
frontend/  Dashboard et checkout React
nginx/     Configuration du reverse proxy
sdk/       SDK (paybf-node, phase 9)
examples/  TeleMed Demo (phase 9)
```

## Roadmap

Phases 1 à 10 détaillées dans `PayBF-conception.md`.
