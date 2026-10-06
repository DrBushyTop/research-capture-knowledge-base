param location string = 'swedencentral'
param suffix string = '16681c6a'
param administratorId string
param administratorLogin string
param tenantId string = subscription().tenantId
param allowedAddresses array = []
param includeDevelopmentDatabase bool = true

resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: 'sql-research-dev-${suffix}'
  location: location
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'User'
      login: administratorLogin
      sid: administratorId
      tenantId: tenantId
      azureADOnlyAuthentication: true
    }
  }
}
resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: server
  name: 'research'
  location: location
  sku: { name: 'S0', tier: 'Standard', capacity: 10 }
  properties: {
    maxSizeBytes: 10737418240
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
    collation: 'Latin1_General_100_BIN2'
  }
}
resource firewall 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for (address, index) in allowedAddresses: {
  parent: server
  name: 'application-${index}'
  properties: { startIpAddress: address, endIpAddress: address }
}]
resource developmentDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = if (includeDevelopmentDatabase) {
  parent: server
  name: 'research_dev'
  location: location
  sku: { name: 'S0', tier: 'Standard', capacity: 10 }
  properties: { maxSizeBytes: 10737418240, requestedBackupStorageRedundancy: 'Local', collation: 'Latin1_General_100_BIN2' }
}
output sqlServer string = server.properties.fullyQualifiedDomainName
output sqlDatabase string = database.name
