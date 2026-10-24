// Tamil Nadu local bodies — mirrors the dataset embedded in the PHP register page
// (createlogin.blade.php). Drives the constituency cascade: position -> district
// -> local body -> ward.
export const ALL_DISTRICTS = ['Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore','Dharmapuri','Dindigul','Erode','Kallakurichi','Kanchipuram','Kanyakumari','Karur','Krishnagiri','Madurai','Mayiladuthurai','Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai','Ramanathapuram','Ranipet','Salem','Sivaganga','Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli','Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Viluppuram','Virudhunagar'];

export const RURAL_POSITIONS = ['Village Panchayat Ward Member', 'Village Panchayat President', 'Panchayat Union Ward Member', 'District Panchayat Ward Member'];
export const URBAN_POSITIONS = ['Town Panchayat', 'Municipality', 'Corporation'];

export const LOCAL_BODIES = {
  corporations: [
    { district: 'Chengalpattu', name: 'Tambaram', wards: 70 }, { district: 'Chennai', name: 'Chennai', wards: 200 },
    { district: 'Coimbatore', name: 'Coimbatore', wards: 100 }, { district: 'Cuddalore', name: 'Cuddalore', wards: 45 },
    { district: 'Dindigul', name: 'Dindigul', wards: 48 }, { district: 'Erode', name: 'Erode', wards: 60 },
    { district: 'Kanchipuram', name: 'Kanchipuram', wards: 51 }, { district: 'Kanyakumari', name: 'Nagercoil', wards: 52 },
    { district: 'Karur', name: 'Karur', wards: 48 }, { district: 'Krishnagiri', name: 'Hosur', wards: 45 },
    { district: 'Madurai', name: 'Madurai', wards: 100 }, { district: 'Salem', name: 'Salem', wards: 60 },
    { district: 'Thanjavur', name: 'Kumbakonam', wards: 48 }, { district: 'Thanjavur', name: 'Thanjavur', wards: 51 },
    { district: 'Thoothukudi', name: 'Thoothukudi', wards: 60 }, { district: 'Tiruchirappalli', name: 'Tiruchirappalli', wards: 65 },
    { district: 'Tirunelveli', name: 'Tirunelveli', wards: 55 }, { district: 'Tiruppur', name: 'Tiruppur', wards: 60 },
    { district: 'Tiruvallur', name: 'Avadi', wards: 48 }, { district: 'Vellore', name: 'Vellore', wards: 60 },
    { district: 'Virudhunagar', name: 'Sivakasi', wards: 48 },
  ],
  municipalities: [
    { district: 'Ariyalur', name: 'Ariyalur', wards: 18 }, { district: 'Ariyalur', name: 'Jayankondam', wards: 21 },
    { district: 'Chengalpattu', name: 'Chengalpattu', wards: 33 }, { district: 'Chengalpattu', name: 'Maduranthakam', wards: 24 },
    { district: 'Chengalpattu', name: 'Maraimalai Nagar', wards: 21 }, { district: 'Chengalpattu', name: 'Nandivaram-Guduvancheri', wards: 30 },
    { district: 'Coimbatore', name: 'Mettupalayam', wards: 33 }, { district: 'Coimbatore', name: 'Pollachi', wards: 36 },
    { district: 'Cuddalore', name: 'Chidambaram', wards: 33 }, { district: 'Cuddalore', name: 'Panruti', wards: 33 },
    { district: 'Cuddalore', name: 'Virudhachalam', wards: 33 }, { district: 'Dharmapuri', name: 'Dharmapuri', wards: 33 },
    { district: 'Dindigul', name: 'Kodaikanal', wards: 24 }, { district: 'Dindigul', name: 'Palani', wards: 33 },
    { district: 'Erode', name: 'Bhavani', wards: 27 }, { district: 'Erode', name: 'Gobichettipalayam', wards: 30 },
    { district: 'Erode', name: 'Sathyamangalam', wards: 27 }, { district: 'Kallakurichi', name: 'Kallakurichi', wards: 21 },
    { district: 'Kanyakumari', name: 'Colachel', wards: 24 }, { district: 'Kanyakumari', name: 'Padmanabhapuram', wards: 21 },
    { district: 'Karur', name: 'Kulithalai', wards: 24 }, { district: 'Krishnagiri', name: 'Krishnagiri', wards: 33 },
    { district: 'Madurai', name: 'Melur', wards: 27 }, { district: 'Madurai', name: 'Thirumangalam', wards: 27 },
    { district: 'Mayiladuthurai', name: 'Mayiladuthurai', wards: 36 }, { district: 'Nagapattinam', name: 'Nagapattinam', wards: 36 },
    { district: 'Namakkal', name: 'Namakkal', wards: 39 }, { district: 'Namakkal', name: 'Tiruchengode', wards: 33 },
    { district: 'Nilgiris', name: 'Coonoor', wards: 30 }, { district: 'Nilgiris', name: 'Udhagamandalam', wards: 36 },
    { district: 'Perambalur', name: 'Perambalur', wards: 21 }, { district: 'Pudukkottai', name: 'Pudukkottai', wards: 42 },
    { district: 'Ramanathapuram', name: 'Paramakudi', wards: 36 }, { district: 'Ramanathapuram', name: 'Ramanathapuram', wards: 33 },
    { district: 'Ranipet', name: 'Arakkonam', wards: 36 }, { district: 'Ranipet', name: 'Ranipet', wards: 30 },
    { district: 'Salem', name: 'Attur', wards: 33 }, { district: 'Salem', name: 'Mettur', wards: 30 },
    { district: 'Sivaganga', name: 'Karaikudi', wards: 36 }, { district: 'Sivaganga', name: 'Sivaganga', wards: 27 },
    { district: 'Tenkasi', name: 'Sankarankovil', wards: 30 }, { district: 'Tenkasi', name: 'Tenkasi', wards: 33 },
    { district: 'Thanjavur', name: 'Pattukkottai', wards: 33 }, { district: 'Theni', name: 'Bodinayakanur', wards: 33 },
    { district: 'Theni', name: 'Theni-Allinagaram', wards: 33 }, { district: 'Thoothukudi', name: 'Kovilpatti', wards: 36 },
    { district: 'Tiruchirappalli', name: 'Manapparai', wards: 27 }, { district: 'Tirunelveli', name: 'Ambasamudram', wards: 21 },
    { district: 'Tirupathur', name: 'Ambur', wards: 36 }, { district: 'Tirupathur', name: 'Vaniyambadi', wards: 36 },
    { district: 'Tiruppur', name: 'Dharapuram', wards: 30 }, { district: 'Tiruvallur', name: 'Thiruvallur', wards: 27 },
    { district: 'Tiruvannamalai', name: 'Arani', wards: 33 }, { district: 'Tiruvannamalai', name: 'Tiruvannamalai', wards: 39 },
    { district: 'Tiruvarur', name: 'Mannargudi', wards: 33 }, { district: 'Tiruvarur', name: 'Tiruvarur', wards: 30 },
    { district: 'Vellore', name: 'Gudiyatham', wards: 36 }, { district: 'Viluppuram', name: 'Tindivanam', wards: 33 },
    { district: 'Viluppuram', name: 'Viluppuram', wards: 42 }, { district: 'Virudhunagar', name: 'Aruppukottai', wards: 36 },
    { district: 'Virudhunagar', name: 'Rajapalayam', wards: 42 }, { district: 'Virudhunagar', name: 'Srivilliputhur', wards: 33 },
    { district: 'Virudhunagar', name: 'Virudhunagar', wards: 36 },
  ],
  town_panchayats: [
    { district: 'Ariyalur', name: 'Udayarpalayam', wards: 15 }, { district: 'Chengalpattu', name: 'Mamallapuram', wards: 15 },
    { district: 'Chengalpattu', name: 'Thirukalukundram', wards: 18 }, { district: 'Coimbatore', name: 'Annur', wards: 15 },
    { district: 'Coimbatore', name: 'Perur', wards: 15 }, { district: 'Coimbatore', name: 'Sulur', wards: 18 },
    { district: 'Cuddalore', name: 'Bhuvanagiri', wards: 18 }, { district: 'Cuddalore', name: 'Kurinjipadi', wards: 18 },
    { district: 'Dharmapuri', name: 'Harur', wards: 18 }, { district: 'Dharmapuri', name: 'Pennagaram', wards: 18 },
    { district: 'Dindigul', name: 'Natham', wards: 18 }, { district: 'Dindigul', name: 'Nilakottai', wards: 15 },
    { district: 'Erode', name: 'Anthiyur', wards: 18 }, { district: 'Erode', name: 'Chennimalai', wards: 15 },
    { district: 'Erode', name: 'Perundurai', wards: 15 }, { district: 'Kallakurichi', name: 'Chinnasalem', wards: 18 },
    { district: 'Kanchipuram', name: 'Uthiramerur', wards: 18 }, { district: 'Kanyakumari', name: 'Kanniyakumari', wards: 18 },
    { district: 'Karur', name: 'Aravakurichi', wards: 15 }, { district: 'Krishnagiri', name: 'Kaveripattinam', wards: 15 },
    { district: 'Madurai', name: 'Vadipatti', wards: 18 }, { district: 'Nagapattinam', name: 'Velankanni', wards: 15 },
    { district: 'Namakkal', name: 'Sendamangalam', wards: 18 }, { district: 'Nilgiris', name: 'Kotagiri', wards: 21 },
    { district: 'Perambalur', name: 'Arumbavur', wards: 15 }, { district: 'Pudukkottai', name: 'Ponnamaravathi', wards: 15 },
    { district: 'Ramanathapuram', name: 'Thondi', wards: 18 }, { district: 'Ranipet', name: 'Thakkolam', wards: 15 },
    { district: 'Salem', name: 'Omalur', wards: 15 }, { district: 'Salem', name: 'Vazhapadi', wards: 15 },
    { district: 'Sivaganga', name: 'Singampunari', wards: 18 }, { district: 'Tenkasi', name: 'Sivagiri', wards: 18 },
    { district: 'Thanjavur', name: 'Orathanadu', wards: 15 }, { district: 'Theni', name: 'Uthamapalayam', wards: 18 },
    { district: 'Thoothukudi', name: 'Srivaikuntam', wards: 18 }, { district: 'Tiruchirappalli', name: 'Manachanallur', wards: 18 },
    { district: 'Tiruchirappalli', name: 'Thottiyam', wards: 15 }, { district: 'Tirunelveli', name: 'Cheranmahadevi', wards: 18 },
    { district: 'Tirunelveli', name: 'Nanguneri', wards: 15 }, { district: 'Tirupathur', name: 'Natrampalli', wards: 15 },
    { district: 'Tiruppur', name: 'Avinashi', wards: 18 }, { district: 'Tiruppur', name: 'Madathukulam', wards: 18 },
    { district: 'Tiruvallur', name: 'Gummidipoondi', wards: 15 }, { district: 'Tiruvallur', name: 'Uthukottai', wards: 15 },
    { district: 'Tiruvannamalai', name: 'Chengam', wards: 18 }, { district: 'Tiruvannamalai', name: 'Polur', wards: 18 },
    { district: 'Tiruvarur', name: 'Muthupet', wards: 18 }, { district: 'Tiruvarur', name: 'Needamangalam', wards: 15 },
    { district: 'Vellore', name: 'Pallikonda', wards: 18 }, { district: 'Viluppuram', name: 'Gingee', wards: 18 },
    { district: 'Viluppuram', name: 'Marakkanam', wards: 18 }, { district: 'Virudhunagar', name: 'Watrap', wards: 18 },
  ],
};

export function districtsFor(position) {
  const key = position === 'Corporation' ? 'corporations'
    : position === 'Municipality' ? 'municipalities'
    : position === 'Town Panchayat' ? 'town_panchayats' : null;
  if (!key) return ALL_DISTRICTS;
  return [...new Set(LOCAL_BODIES[key].map((x) => x.district))].sort();
}

export function bodiesFor(position, district) {
  const key = position === 'Corporation' ? 'corporations'
    : position === 'Municipality' ? 'municipalities'
    : position === 'Town Panchayat' ? 'town_panchayats' : null;
  if (!key) return [];
  return LOCAL_BODIES[key].filter((x) => x.district === district);
}
