require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'http-session-reset'
  s.version        = package['version']
  s.summary        = 'Resets the OS HTTP connection pool on resume'
  s.description    = 'Native module that calls URLSession.shared.reset() on iOS to evict zombie TCP connections when the app returns to foreground.'
  s.license        = { :type => 'MIT' }
  s.author         = 'BrosPharma'
  s.homepage       = 'https://github.com/placeholder'
  s.platform       = :ios, '15.1'
  s.swift_version  = '5.4'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.{h,m,mm,swift}'
end
