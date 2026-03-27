import { db } from "../server/db";
import { organizations, organizationNetworkSettings } from "../shared/schema";
import { eq } from "drizzle-orm";

const CONTRACTORS = [
  {
    org: {
      name: "Summit Electrical Solutions",
      slug: "summit-electrical-solutions",
      tradeType: "ELECTRICAL" as const,
      tradeName: "Commercial & Residential Electrical",
      city: "Denver",
      state: "CO",
      zipCode: "80202",
      phone: "303-555-0101",
      email: "info@summitelectrical.example.com",
      region: "Mountain West",
      typicalCrewSize: 25,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Full-service electrical contractor specializing in commercial build-outs, industrial power systems, and residential rewiring. Licensed master electricians on every job.",
      companyDescription: "Summit Electrical Solutions has been serving the Denver metro area and Front Range for over 18 years. We handle everything from new construction wiring to complex industrial control systems.",
      serviceAreas: ["Denver", "Boulder", "Colorado Springs", "Fort Collins"],
      tradeSpecialties: ["ELECTRICAL", "LOW_VOLTAGE", "SOLAR"],
      certifications: ["Master Electrician License", "OSHA 30", "NFPA 70E Certified"],
      yearsInBusiness: 18,
      foundedYear: 2008,
      licenseNumbers: ["CO-EL-2008-4421"],
      avgRating: "4.80",
      reviewCount: 47,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "Ironclad Concrete & Masonry",
      slug: "ironclad-concrete-masonry",
      tradeType: "CONCRETE" as const,
      tradeName: "Concrete & Masonry Work",
      city: "Houston",
      state: "TX",
      zipCode: "77002",
      phone: "713-555-0202",
      email: "bids@ironcladconcrete.example.com",
      region: "Gulf Coast",
      typicalCrewSize: 40,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Heavy commercial concrete and masonry specialists. Foundations, tilt-wall, structural slabs, and decorative masonry for projects of all sizes.",
      companyDescription: "Ironclad Concrete & Masonry is a Houston-based firm known for delivering on schedule and on budget. Our fleet includes 12 pump trucks and a full batch plant.",
      serviceAreas: ["Houston", "San Antonio", "Austin", "Dallas-Fort Worth"],
      tradeSpecialties: ["CONCRETE", "MASONRY"],
      certifications: ["ACI Certified", "OSHA 30", "TxDOT Pre-Qualified"],
      yearsInBusiness: 22,
      foundedYear: 2004,
      licenseNumbers: ["TX-CON-2004-8832"],
      avgRating: "4.50",
      reviewCount: 63,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "Northern Comfort HVAC",
      slug: "northern-comfort-hvac",
      tradeType: "HVAC" as const,
      tradeName: "Heating, Ventilation & Air Conditioning",
      city: "Chicago",
      state: "IL",
      zipCode: "60601",
      phone: "312-555-0303",
      email: "service@northerncomfort.example.com",
      region: "Midwest",
      typicalCrewSize: 30,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Commercial HVAC installation, maintenance, and energy-efficiency retrofits. Certified in all major brands with 24/7 emergency service available.",
      companyDescription: "Northern Comfort HVAC serves the greater Chicago area with design-build mechanical solutions for offices, hospitals, schools, and multi-family housing.",
      serviceAreas: ["Chicago", "Naperville", "Evanston", "Schaumburg"],
      tradeSpecialties: ["HVAC", "INSULATION", "FIRE_PROTECTION"],
      certifications: ["EPA 608 Universal", "NATE Certified", "LEED AP"],
      yearsInBusiness: 15,
      foundedYear: 2011,
      licenseNumbers: ["IL-HVAC-2011-6743"],
      avgRating: "4.70",
      reviewCount: 38,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "Pacific Rim Roofing",
      slug: "pacific-rim-roofing",
      tradeType: "ROOFING" as const,
      tradeName: "Commercial & Industrial Roofing",
      city: "Seattle",
      state: "WA",
      zipCode: "98101",
      phone: "206-555-0404",
      email: "quotes@pacificrimroofing.example.com",
      region: "Pacific Northwest",
      typicalCrewSize: 35,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Flat-roof and metal roofing experts for commercial and industrial buildings. Full tear-off, re-roofing, and preventative maintenance programs.",
      companyDescription: "Pacific Rim Roofing has completed over 500 commercial roofing projects across the Pacific Northwest, including warehouses, hospitals, and government facilities.",
      serviceAreas: ["Seattle", "Tacoma", "Portland", "Olympia"],
      tradeSpecialties: ["ROOFING", "WATERPROOFING"],
      certifications: ["GAF Master Elite", "OSHA 30", "Duro-Last Certified Installer"],
      yearsInBusiness: 12,
      foundedYear: 2014,
      licenseNumbers: ["WA-ROOF-2014-3319"],
      avgRating: "4.60",
      reviewCount: 29,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "Apex General Contractors",
      slug: "apex-general-contractors",
      tradeType: "GENERAL_CONTRACTOR" as const,
      tradeName: "General Construction",
      city: "Phoenix",
      state: "AZ",
      zipCode: "85001",
      phone: "602-555-0505",
      email: "projects@apexgc.example.com",
      region: "Southwest",
      typicalCrewSize: 60,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Full-service general contractor handling ground-up commercial, tenant improvements, and design-build projects across the Southwest.",
      companyDescription: "Apex General Contractors manages large-scale commercial construction with a focus on healthcare, education, and retail. Bonding capacity up to $50M.",
      serviceAreas: ["Phoenix", "Scottsdale", "Tucson", "Mesa"],
      tradeSpecialties: ["GENERAL_CONTRACTOR"],
      certifications: ["LEED AP BD+C", "OSHA 30", "Arizona ROC Licensed"],
      yearsInBusiness: 25,
      foundedYear: 2001,
      licenseNumbers: ["AZ-ROC-2001-267891"],
      avgRating: "4.90",
      reviewCount: 72,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "BlueLine Plumbing Co.",
      slug: "blueline-plumbing-co",
      tradeType: "PLUMBING" as const,
      tradeName: "Commercial Plumbing",
      city: "Atlanta",
      state: "GA",
      zipCode: "30301",
      phone: "404-555-0606",
      email: "dispatch@bluelineplumbing.example.com",
      region: "Southeast",
      typicalCrewSize: 20,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Licensed commercial plumbing contractor providing new-construction rough-in, medical gas, and fire-suppression piping across the Southeast.",
      companyDescription: "BlueLine Plumbing Co. is an Atlanta-based plumbing firm with expertise in multi-story residential, healthcare, and hospitality plumbing systems.",
      serviceAreas: ["Atlanta", "Savannah", "Augusta", "Macon"],
      tradeSpecialties: ["PLUMBING", "FIRE_PROTECTION"],
      certifications: ["Master Plumber License", "Medical Gas Certified", "OSHA 10"],
      yearsInBusiness: 10,
      foundedYear: 2016,
      licenseNumbers: ["GA-PLB-2016-9987"],
      avgRating: "4.30",
      reviewCount: 21,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "Greenscape Landscaping & Design",
      slug: "greenscape-landscaping-design",
      tradeType: "LANDSCAPING" as const,
      tradeName: "Commercial Landscaping",
      city: "Orlando",
      state: "FL",
      zipCode: "32801",
      phone: "407-555-0707",
      email: "design@greenscapeland.example.com",
      region: "Southeast",
      typicalCrewSize: 45,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Commercial landscaping, hardscaping, and irrigation design for HOAs, office parks, and hospitality properties. Sustainable and native-plant specialists.",
      companyDescription: "Greenscape Landscaping & Design transforms outdoor spaces with drought-tolerant design and smart irrigation throughout Central Florida.",
      serviceAreas: ["Orlando", "Tampa", "Jacksonville", "Miami"],
      tradeSpecialties: ["LANDSCAPING"],
      certifications: ["Florida Landscape License", "Irrigation Association Certified", "ISA Arborist"],
      yearsInBusiness: 8,
      foundedYear: 2018,
      licenseNumbers: ["FL-LAND-2018-5521"],
      avgRating: "4.40",
      reviewCount: 15,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "SteelFrame Demolition",
      slug: "steelframe-demolition",
      tradeType: "DEMOLITION" as const,
      tradeName: "Demolition & Abatement",
      city: "Detroit",
      state: "MI",
      zipCode: "48201",
      phone: "313-555-0808",
      email: "ops@steelframedemo.example.com",
      region: "Midwest",
      typicalCrewSize: 50,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Selective and full-structure demolition, asbestos abatement, and environmental remediation. Bonded and insured for projects up to $20M.",
      companyDescription: "SteelFrame Demolition is Michigan's premier demolition contractor with a perfect safety record over the past five years.",
      serviceAreas: ["Detroit", "Grand Rapids", "Ann Arbor", "Lansing"],
      tradeSpecialties: ["DEMOLITION"],
      certifications: ["EPA RRP Certified", "OSHA 40 HAZWOPER", "Michigan Demo License"],
      yearsInBusiness: 14,
      foundedYear: 2012,
      licenseNumbers: ["MI-DEMO-2012-7788"],
      avgRating: "4.20",
      reviewCount: 33,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "SunPeak Solar & Energy",
      slug: "sunpeak-solar-energy",
      tradeType: "SOLAR" as const,
      tradeName: "Solar Installation & Energy",
      city: "Las Vegas",
      state: "NV",
      zipCode: "89101",
      phone: "702-555-0909",
      email: "solar@sunpeakenergy.example.com",
      region: "Southwest",
      typicalCrewSize: 28,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Commercial and utility-scale solar installations with battery storage integration. NABCEP-certified team with over 50 MW installed.",
      companyDescription: "SunPeak Solar & Energy designs and installs solar PV systems for commercial rooftops, ground-mount arrays, and carport structures in Nevada and surrounding states.",
      serviceAreas: ["Las Vegas", "Reno", "Henderson", "Phoenix"],
      tradeSpecialties: ["SOLAR", "ELECTRICAL"],
      certifications: ["NABCEP PV Installation", "OSHA 30", "NV C-2 License"],
      yearsInBusiness: 7,
      foundedYear: 2019,
      licenseNumbers: ["NV-SOL-2019-1234"],
      avgRating: "4.75",
      reviewCount: 19,
      isDirectoryListed: true,
    },
  },
  {
    org: {
      name: "Precision Drywall & Finishing",
      slug: "precision-drywall-finishing",
      tradeType: "DRYWALL" as const,
      tradeName: "Drywall & Interior Finishing",
      city: "Nashville",
      state: "TN",
      zipCode: "37201",
      phone: "615-555-1010",
      email: "jobs@precisiondrywall.example.com",
      region: "Southeast",
      typicalCrewSize: 32,
      onboardingStatus: "COMPLETED" as const,
      isActive: true,
    },
    settings: {
      bio: "Expert drywall hanging, finishing, and acoustic ceiling installation for commercial and multi-family projects. Known for Level 5 finish quality.",
      companyDescription: "Precision Drywall & Finishing serves Middle Tennessee with high-quality interior finishing. We handle metal framing, drywall, taping, and specialty textures.",
      serviceAreas: ["Nashville", "Memphis", "Knoxville", "Chattanooga"],
      tradeSpecialties: ["DRYWALL", "INSULATION"],
      certifications: ["AWCI Member", "OSHA 10", "TN Contractor License"],
      yearsInBusiness: 11,
      foundedYear: 2015,
      licenseNumbers: ["TN-DRY-2015-6632"],
      avgRating: "4.55",
      reviewCount: 26,
      isDirectoryListed: true,
    },
  },
];

async function main() {
  console.log("========================================");
  console.log("  Marketplace Contractors Seeder");
  console.log("========================================\n");

  let created = 0;
  let skipped = 0;

  for (const contractor of CONTRACTORS) {
    const existing = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, contractor.org.slug))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  SKIP: "${contractor.org.name}" already exists (slug: ${contractor.org.slug})`);
      const existingSettings = await db
        .select()
        .from(organizationNetworkSettings)
        .where(eq(organizationNetworkSettings.organizationId, existing[0].id))
        .limit(1);

      if (existingSettings.length === 0) {
        await db.insert(organizationNetworkSettings).values({
          organizationId: existing[0].id,
          ...contractor.settings,
        });
        console.log(`    -> Added network settings with isDirectoryListed=true`);
      } else if (!existingSettings[0].isDirectoryListed) {
        await db
          .update(organizationNetworkSettings)
          .set({ isDirectoryListed: true, ...contractor.settings })
          .where(eq(organizationNetworkSettings.organizationId, existing[0].id));
        console.log(`    -> Updated network settings with isDirectoryListed=true`);
      }
      skipped++;
      continue;
    }

    const [org] = await db.insert(organizations).values(contractor.org).returning();
    console.log(`  CREATED: "${contractor.org.name}" (id: ${org.id})`);

    await db.insert(organizationNetworkSettings).values({
      organizationId: org.id,
      ...contractor.settings,
    });
    console.log(`    -> Network settings with isDirectoryListed=true`);

    created++;
  }

  console.log(`\n========================================`);
  console.log(`  DONE: ${created} created, ${skipped} skipped`);
  console.log(`========================================\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
