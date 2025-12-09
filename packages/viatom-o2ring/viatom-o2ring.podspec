Pod::Spec.new do |s|
  s.name         = "viatom-o2ring"
  s.version      = "1.0.0"
  s.summary      = "Viatom O2Ring bridge for iOS"
  s.dependency "ExpoModulesCore"

  s.homepage = "https://sleepeasysingapore.com"
  s.authors = { "SleepEasy" => "sleep.easy.sg@gmail.com" }
  s.license = { :type => "MIT" }
  s.source = { :path => "."}

  s.source_files = "ios/*.swift"
  s.vendored_frameworks = "ios/VTMProductLib.xcframework", "ios/VTO2Lib.xcframework"

  s.platform     = :ios, "13.0"
end
