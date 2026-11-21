import { useEffect, useRef } from 'react';
import type { Quality } from '../lib/prefs';
import { useGlRecovery } from './glRecovery';
import type { GameClock } from './clock';
import { BusRide, type RideVehicle } from './BusRide';
import type { PersonLook } from './kit';

/** Trajet en bus vu de l'intérieur, par-dessus la ville (qui continue de calculer le trajet sans s'afficher). */
export default function BusRideScene({ quality, look, clock, vehicle = 'bus' }: { quality: Quality; look: PersonLook; clock: GameClock; vehicle?: RideVehicle }) {
  const el = useRef<HTMLDivElement>(null);
  const glGen = useGlRecovery(el);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let ride: BusRide | null = null;
    try {
      ride = new BusRide(node, quality, look, vehicle);
      ride.getMinute = () => clock.minuteOfDay();
    } catch {
      ride = null;
    }
    return () => ride?.dispose();
  }, [quality, look, clock, vehicle, glGen]);
  return <div ref={el} className="scene bus-ride" />;
}
