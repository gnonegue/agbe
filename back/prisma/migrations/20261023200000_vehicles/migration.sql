-- Concession : motos et voitures achetées par les joueurs (carburant, kilométrage, entretien, dégâts).
CREATE TABLE "owned_vehicle" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "modelId" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(4) NOT NULL,
    "fuelMl" INTEGER NOT NULL,
    "odometerM" INTEGER NOT NULL DEFAULT 0,
    "sinceServiceM" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "boughtPrice" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),

    CONSTRAINT "owned_vehicle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "owned_vehicle_characterId_soldAt_idx" ON "owned_vehicle"("characterId", "soldAt");

ALTER TABLE "owned_vehicle" ADD CONSTRAINT "owned_vehicle_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trois stations-service (carburant et entretien) : au nord-ouest, à l'est et sur le boulevard Eyadéma.
INSERT INTO venue (id, emoji, "nameFr", "nameEn", "districtFr", "districtEn", "descFr", "descEn", x, z) VALUES
 ('station_oryx', '⛽', 'Station Oryx Energies', 'Oryx Energies station', 'Tokoin', 'Tokoin', 'Station-service : plein d’essence, entretien et réparations pour ta moto ou ta voiture.', 'Petrol station: fuel, servicing and repairs for your motorbike or car.', -66, -124),
 ('station_total', '⛽', 'Station TotalEnergies', 'TotalEnergies station', 'Hédzranawoé', 'Hédzranawoé', 'Station-service : plein d’essence, entretien et réparations pour ta moto ou ta voiture.', 'Petrol station: fuel, servicing and repairs for your motorbike or car.', 115, -125),
 ('station_boulevard', '⛽', 'Station-service du boulevard Eyadéma', 'Boulevard Eyadéma petrol station', 'Agoè', 'Agoè', 'Station-service sur le boulevard Eyadéma : plein d’essence, entretien et réparations.', 'Petrol station on Boulevard Eyadéma: fuel, servicing and repairs.', 28, -222)
ON CONFLICT (id) DO NOTHING;
