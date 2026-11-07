import { describe, expect, it } from 'vitest'
import type { JavaLibrary } from '@/lib/code-studio-api'
import {
  dependencyBlockAt, findLibrary, isJavaBuildConfig, javaBuildLabel, javaBuildTools, libraryOfSourcesPath, moduleOfBuildFile, shortGroup,
} from './javaLibraries'

const library = (groupId: string, artifactId: string, version: string, modules: string[] = ['']): JavaLibrary => ({ groupId, artifactId, version, direct: true, modules, downloaded: true, sources: true })

describe('javaLibraries', () => {
  it('finds the library of an extracted source file, on Windows paths too', () => {
    const libraries = [library('org.slf4j', 'slf4j-api', '2.0.9'), library('com.google.guava', 'guava', '33.0')]
    expect(libraryOfSourcesPath('C:\\Users\\a\\AppData\\Local\\adomnia\\virtual\\maven-sources\\com.google.guava\\guava\\33.0\\com\\google\\common\\base\\Strings.java', libraries))
      .toEqual({ library: libraries[1], file: 'com/google/common/base/Strings.java' })
    expect(libraryOfSourcesPath('/home/a/project/src/Main.java', libraries)).toBeNull()
  })

  it('prefers the version of the module that asks', () => {
    const libraries = [library('g', 'a', '1', ['core']), library('g', 'a', '2', ['web'])]
    expect(findLibrary(libraries, 'g', 'a', 'web')?.version).toBe('2')
    expect(findLibrary(libraries, 'g', 'a')?.version).toBe('1')
    expect(findLibrary(libraries, 'g', 'missing')).toBeNull()
  })

  it('reads the dependency block around the cursor', () => {
    const pom = [
      '<project>',
      '  <dependencies>',
      '    <dependency>',
      '      <groupId>org.slf4j</groupId>',
      '      <artifactId>slf4j-api</artifactId>',
      '      <version>2.0.9</version>',
      '    </dependency>',
      '  </dependencies>',
      '  <build><plugins>',
      '    <plugin>',
      '      <artifactId>maven-surefire-plugin</artifactId>',
      '    </plugin>',
      '  </plugins></build>',
      '</project>',
    ].join('\n')
    expect(dependencyBlockAt(pom, 5)).toEqual({ groupId: 'org.slf4j', artifactId: 'slf4j-api' })
    expect(dependencyBlockAt(pom, 3)).toEqual({ groupId: 'org.slf4j', artifactId: 'slf4j-api' })
    expect(dependencyBlockAt(pom, 11)).toEqual({ groupId: 'org.apache.maven.plugins', artifactId: 'maven-surefire-plugin' })
    expect(dependencyBlockAt(pom, 8)).toBeNull()
    expect(dependencyBlockAt(pom, 1)).toBeNull()
  })

  it('shortens long groups', () => {
    expect(shortGroup('org.springframework.boot')).toBe('springframework.boot')
    expect(shortGroup('junit')).toBe('junit')
  })

  describe('Gradle projects', () => {
    it('recognises every build file that changes the dependencies', () => {
      for (const path of ['pom.xml', 'build.gradle', 'build.gradle.kts', 'app/build.gradle.kts', 'settings.gradle', 'gradle/libs.versions.toml', 'gradle.properties']) {
        expect(isJavaBuildConfig(path), path).toBe(true)
      }
      expect(isJavaBuildConfig('src/main/java/App.java')).toBe(false)
      expect(isJavaBuildConfig('build.gradle.kts.bak')).toBe(false)
    })

    it('gives the module directory of a Gradle build file', () => {
      expect(moduleOfBuildFile('build.gradle')).toBe('')
      expect(moduleOfBuildFile('build.gradle.kts')).toBe('')
      expect(moduleOfBuildFile('app/build.gradle')).toBe('app')
      expect(moduleOfBuildFile('services/api/build.gradle.kts')).toBe('services/api')
      expect(moduleOfBuildFile('core/pom.xml')).toBe('core')
    })

    it('labels the build tools of the project', () => {
      expect(javaBuildTools([{ language: 'java', kind: 'gradle' }])).toEqual(['gradle'])
      expect(javaBuildTools([{ language: 'java', kind: 'maven' }, { language: 'java', kind: 'gradle' }])).toEqual(['maven', 'gradle'])
      expect(javaBuildTools([{ language: 'go', kind: 'module' }])).toEqual([])
      expect(javaBuildLabel(['gradle'])).toBe('Gradle')
      expect(javaBuildLabel(['maven', 'gradle'])).toBe('Maven · Gradle')
    })
  })
})
