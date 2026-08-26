// Stripe test-mode magic values for Singapore.
//
// These only work in test mode and only on API-onboarded (dashboard: 'none')
// accounts — an Express account's KYC belongs to Stripe, and the platform is
// forbidden from writing these fields (the API returns oauth_not_supported).
//
// Values verified empirically against the live test API, not copied from docs:
//   dob 1901-01-01        forces instant identity verification
//   id_number 000000000   forces a successful ID check
//   line1 address_full_match  forces a successful address check
//   routing 7171-001      DBS/POSB — SG needs bank_code-branch_code, and most
//                         plausible-looking codes are rejected
//   full_name_aliases ['']  MUST be [''], not [] — an empty array leaves the
//                         requirement outstanding and charges stay disabled
//   business_profile.url  reserved domains (example.com) are rejected outright

function sgTestOnboarding(merchant) {
  const slug = merchant.id.replace(/[^a-z0-9]/gi, '');
  return {
    business_profile: {
      url: `https://${slug}.sg`,
      mcc: '5812', // Eating Places / Restaurants
      name: merchant.name,
    },
    individual: {
      first_name: 'Jenny',
      last_name: 'Rosen',
      email: `owner+${slug}@example.com`,
      phone: '+6581234567',
      dob: { day: 1, month: 1, year: 1901 },
      id_number: '000000000',
      nationality: 'SG',
      full_name_aliases: [''],
      address: {
        line1: 'address_full_match',
        city: 'Singapore',
        postal_code: '048616',
        country: 'SG',
      },
    },
    external_account: {
      object: 'bank_account',
      country: 'SG',
      currency: 'sgd',
      account_number: '000123456',
      routing_number: '7171-001',
    },
    tos_acceptance: {
      date: Math.floor(Date.now() / 1000),
      ip: '8.8.8.8',
    },
  };
}

module.exports = { sgTestOnboarding };
