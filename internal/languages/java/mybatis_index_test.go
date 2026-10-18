package java

import "testing"

func TestMyBatisIndexLinksMapperMethodsAndXMLStatements(t *testing.T) {
	root := writeFixture(t, map[string]string{
		"pom.xml": "<project/>",
		"src/main/java/com/acme/UserMapper.java": `package com.acme;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface UserMapper {
    User findById(@Param("id") long id);

    int insertUser(User user);

    @Select("select count(*) from users")
    int count();

    void orphanMethod();
}
`,
		"src/main/java/com/acme/Other.java": "package com.acme;\npublic interface Other { void ignored(); }\n",
		"src/main/resources/mappers/UserMapper.xml": `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="com.acme.UserMapper">
  <select id="findById" resultType="com.acme.User">
    select * from users where id = #{id}
  </select>
  <insert id="insertUser">insert into users values (#{name})</insert>
  <delete id="removeStale">delete from users</delete>
</mapper>
`,
		"src/main/resources/application.xml": "<beans><bean id=\"x\"/></beans>",
	})
	index := BuildMyBatisIndex(root)
	by := map[string]MyBatisLink{}
	for _, link := range index.Links {
		by[link.ID] = link
	}
	if len(index.Links) != 4 {
		t.Fatalf("links = %+v", index.Links)
	}
	find := by["findById"]
	if find.State != myBatisBothSides || find.Kind != "select" || find.XMLLine != 3 || find.JavaLine != 7 || find.XMLFile != "src/main/resources/mappers/UserMapper.xml" || find.JavaFile != "src/main/java/com/acme/UserMapper.java" {
		t.Fatalf("findById = %+v", find)
	}
	if find.XMLEndCol-find.XMLStartCol != len("findById") {
		t.Fatalf("the XML range must cover the id value: %+v", find)
	}
	if by["insertUser"].State != myBatisBothSides {
		t.Fatalf("insertUser = %+v", by["insertUser"])
	}
	if stale := by["removeStale"]; stale.State != myBatisXMLOnly || stale.JavaFile != "" {
		t.Fatalf("an XML statement without a method stays xmlOnly: %+v", stale)
	}
	if orphan := by["orphanMethod"]; orphan.State != myBatisJavaOnly || orphan.XMLFile != "" {
		t.Fatalf("a method without a statement is javaOnly: %+v", orphan)
	}
	if _, annotated := by["count"]; annotated {
		t.Fatal("a method with @Select needs no XML statement")
	}
	if _, other := by["ignored"]; other {
		t.Fatal("interfaces without a mapper XML are ignored")
	}
}
