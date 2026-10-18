package com.example.__PACKAGE__;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AppTest {

    @Test
    void greetsTheGivenName() {
        assertEquals("Hello, adOmnia!", App.greet("adOmnia"));
    }

    @Test
    void greetsTheWorldWithoutAName() {
        assertEquals("Hello, world!", App.greet(" "));
    }
}
