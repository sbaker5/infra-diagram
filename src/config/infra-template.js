// Infrastructure template for gap detection
// Modify this file to customize the standard infrastructure components

module.exports = {
  categories: [
    {
      name: "Network",
      color: "#4A90D9",
      components: ["Firewall", "VPN", "Load Balancer", "DNS", "CDN", "Router/Switch"]
    },
    {
      name: "Compute",
      color: "#7B68EE",
      components: ["Physical Servers", "Virtual Machines", "Containers", "Serverless", "Desktop/Workstations"]
    },
    {
      name: "Storage",
      color: "#50C878",
      components: ["Database", "File Storage", "Backups", "Object Storage", "NAS/SAN"]
    },
    {
      name: "Security",
      color: "#FF6B6B",
      components: ["Antivirus/EDR", "MFA", "SIEM", "Email Security", "Vulnerability Scanner", "PAM"]
    },
    {
      name: "Cloud",
      color: "#FF9F43",
      components: ["AWS", "Azure", "GCP", "Microsoft 365", "Other SaaS"]
    },
    {
      name: "Applications",
      color: "#A855F7",
      components: ["CRM", "ERP", "Productivity Suite", "Custom Apps", "Collaboration Tools"]
    },
    {
      name: "Identity",
      color: "#06B6D4",
      components: ["Active Directory", "SSO/SAML", "LDAP", "Identity Provider"]
    },
    {
      name: "Monitoring",
      color: "#84CC16",
      components: ["Network Monitoring", "Log Management", "APM", "Alerting"]
    }
  ]
};
