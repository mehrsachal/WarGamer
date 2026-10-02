// Fictional place and unit names for generated scenarios (Blueland vs Foxland setting).
import type { Rng } from '../core/rng';

const PRE = ['Ali', 'Qasim', 'Nasir', 'Hafiz', 'Islam', 'Wazir', 'Jaleel', 'Khair', 'Rahim', 'Karim', 'Sadiq', 'Bahadur', 'Fateh', 'Sher', 'Jahan', 'Mehr', 'Noor', 'Sultan', 'Akbar', 'Faiz', 'Saif', 'Hayat', 'Mubarak', 'Shah', 'Lal', 'Kot', 'Chak', 'Pind', 'Dhok', 'Mian', 'Gul', 'Raja', 'Malik', 'Azam', 'Tariq', 'Iqbal', 'Bilal', 'Zafar'];
const SUF = ['abad', 'pur', 'wala', 'nagar', 'garh', 'kot', ' Kalan', ' Khurd', 'wal', 'ana', 'pura', 'sar'];
const FOX = ['Ram', 'Mohali', 'Gandhi Nagar', 'Shivpur', 'Ganga', 'Pratap', 'Devi', 'Rampura', 'Hari', 'Kishan', 'Arjun', 'Lakshmi', 'Suraj', 'Indra', 'Mohan', 'Vijay'];
const REGTS = ['Baloch', 'Punjab', 'FF', 'Sind', 'AK', 'NLI', 'Baloch', 'Punjab'];

export function villageName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    let n: string;
    const r = rng.next();
    if (r < 0.12) n = `Chak ${rng.int(2, 99)}`;
    else if (r < 0.2) n = `Dhok ${rng.pick(PRE)}`;
    else if (r < 0.26) n = `Kot ${rng.pick(PRE)}`;
    else {
      const p = rng.pick(PRE.filter((x) => x !== 'Chak' && x !== 'Dhok' && x !== 'Kot' && x !== 'Pind'));
      n = p + rng.pick(SUF);
    }
    n = n.toUpperCase();
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  const n = `VILL ${used.size + 1}`;
  used.add(n);
  return n;
}

export function foxName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 30; i++) {
    const n = rng.pick(FOX).toUpperCase();
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return villageName(rng, used);
}

export function unitNames(rng: Rng): { bn: string; bnNo: number; bde: number; div: number; enBde: number; fdRegt: number; engrs: number; lat: string } {
  const bnNo = rng.int(11, 199);
  return {
    bnNo,
    bn: `${bnNo} ${rng.pick(REGTS)}`,
    bde: rng.int(1, 40) * 10 + rng.pick([0, 5]),
    div: rng.int(7, 40),
    enBde: rng.int(20, 180),
    fdRegt: rng.int(20, 160),
    engrs: rng.int(10, 120),
    lat: `${rng.int(11, 199)} ${rng.pick(REGTS)}`,
  };
}

export const COMDR_NAMES = ['Hasnain', 'Ahmed', 'Usman', 'Bilal', 'Hamza', 'Saad', 'Raza', 'Umar', 'Fahad', 'Zeeshan', 'Imran', 'Junaid', 'Kamran', 'Talha'];
