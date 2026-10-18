package com.example.__PACKAGE__;

public class App {

    public static String greet(String name) {
        return "Hello, " + (name == null || name.isBlank() ? "world" : name) + "!";
    }

    public static void main(String[] args) {
        System.out.println(greet(args.length > 0 ? args[0] : null));
    }
}
